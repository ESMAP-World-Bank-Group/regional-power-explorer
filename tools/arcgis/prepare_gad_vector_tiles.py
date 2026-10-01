"""
Prepare the WB GAD map in ArcGIS Pro for Create Vector Tile Package.

For each admin layer this script:
  1. sets a visibility scale range, so each tile only carries the layers
     visible at its zoom (ADM2 is not packed into world-level tiles);
  2. sets symbology. Pro never writes field values onto tile polygons: the
     only identity a polygon carries is `_symbol`, its Unique Values class
     index, and the style maps each index to its field values (layer ids like
     "WB_GAD_ADM0/IND,IND,SAR"). So every layer gets Unique Values on its key
     field(s), with every value in its own class;
  3. adds one Arcade label class per field ($feature.FIELD), with the layer's
     scale range. Pro writes these as separate label points carrying only
     `_name` (the label text), which is how ADM1/ADM2 names and codes reach
     the tiles.

Optionally it then builds a small TEST package (world, zooms 0-7) so a tile
can be decoded to confirm the fields came through before the full export.

Run it from the Python window in ArcGIS Pro with the project open
(PROJECT = "CURRENT"), or standalone with PROJECT set to an .aprx path.
It also saves a copy of the prepared project to OUTPUT_APRX. With
PROJECT = "CURRENT" the open map is changed too -- don't save the original
project afterwards if you want to keep its current symbology.
"""
import copy
import os

import arcpy


def fail(msg):
    # Pro's Python window can swallow SystemExit silently; print, then raise
    # an ordinary error so the stop is visible either way.
    print(f"ERROR: {msg}")
    raise RuntimeError(msg)

# ── Configuration ─────────────────────────────────────────────────────────────

PROJECT = "CURRENT"          # or r"C:\path\to\project.aprx"
MAP_NAME = None              # None = the active map / first map in the project
OUTPUT_APRX = r"C:\temp\WB_GAD_vector_tiles.aprx"

# Scale thresholds on the ArcGIS Online / Google tiling scheme. A layer is
# written into a zoom level's tiles only if it is visible at that level's
# scale, so each threshold sits just above the level's scale:
#   z4 = 1:18,489,298   z7 = 1:2,311,162
Z4 = 18_500_000
Z7 = 2_312_000

# layer name in the map -> `unique`: Unique Values fields (None = Single
# Symbol), `fields`: label fields, and the zoomed-out limit (min_scale;
# 0 = visible at every zoom). Unique Values ids are the field values joined
# by commas, so put free-text fields (names) last. Names are matched case-insensitively
# against the layer names in the Contents pane.
LAYERS = {
    "WB_GAD_ADM0": {"unique": ["ISO_A3", "WB_A3", "WB_REGION"],
                    "fields": ["ISO_A3", "WB_A3", "WB_REGION"], "min_scale": 0},
    "World_Bank_Official_Boundaries___NDLSA": {"unique": ["SOV_NAME", "NAM_0"],
                                               "fields": ["NAM_0", "SOV_NAME", "SOV_ISO_A3"], "min_scale": 0},
    # ADM1 (~3,200 classes) and ADM2 (~40,000) are keyed on their codes so
    # every unit is joinable. The cost is style size: ADM2 alone puts it at
    # several megabytes, downloaded by every app before it draws.
    "WB_GAD_ADM1": {"unique": ["ADM1CD_t"],
                    "fields": ["ADM1CD_t", "NAM_1", "WB_REGION"], "min_scale": Z4},
    "WB_GAD_ADM2": {"unique": ["ADM2CD_t"], "fields": ["ADM2CD_t", "NAM_2"], "min_scale": Z7},
}

# The tile index built with Create Vector Tile Index. It is switched off so it
# isn't packaged as a map layer (Pro only tiles visible layers) and passed to
# the package tool as index_polygons instead. None if there is no index.
INDEX_LAYER = "WB_GAD_Polygons_Admin012"

# Build a small test package after preparing the map (None to skip).
TEST_PACKAGE = r"C:\temp\WB_GAD_test.vtpk"
TEST_MAX_SCALE = 2_311_162   # stop at z7: enough to see ADM0/1/2 all appear

# ── Script ────────────────────────────────────────────────────────────────────


def find_map(aprx):
    if MAP_NAME:
        maps = aprx.listMaps(MAP_NAME)
        if not maps:
            fail(f"No map named {MAP_NAME!r}. Maps: {[m.name for m in aprx.listMaps()]}")
        return maps[0]
    if PROJECT == "CURRENT" and aprx.activeMap:
        return aprx.activeMap
    return aprx.listMaps()[0]


def find_layer(m, name):
    for lyr in m.listLayers():
        if lyr.isFeatureLayer and lyr.name.lower() == name.lower():
            return lyr
    names = [l.name for l in m.listLayers() if l.isFeatureLayer]
    fail(f"No feature layer {name!r} in map {m.name!r}. Feature layers: {names}")


def existing_fields(lyr, wanted):
    have = {f.name.lower(): f.name for f in arcpy.ListFields(lyr)}
    found, missing = [], []
    for f in wanted:
        (found if f.lower() in have else missing).append(have.get(f.lower(), f))
    if missing:
        print(f"  ! {lyr.name}: fields not found, skipped: {missing}")
    return found


def distinct_values(lyr, fields):
    with arcpy.da.SearchCursor(lyr, fields) as cur:
        return {tuple("" if v is None else str(v) for v in row) for row in cur}


def set_symbology(lyr, unique):
    sym = lyr.symbology
    if not hasattr(sym, "renderer"):
        fail(f"{lyr.name}: symbology has no renderer to set")
    if not unique:
        if sym.renderer.type != "SimpleRenderer":
            sym.updateRenderer("SimpleRenderer")
            lyr.symbology = sym
        return
    # Setting the fields regenerates the classes from the data, one per
    # distinct combination (Pro's "Add all values").
    sym.updateRenderer("UniqueValueRenderer")
    sym.renderer.fields = unique
    lyr.symbology = sym
    classes = sum(len(g.items) for g in lyr.symbology.renderer.groups)
    distinct = len(distinct_values(lyr, unique))
    note = "" if classes >= distinct else (
        f" -- {distinct - classes} value(s) have no class and would fall into"
        " 'all other values'; use Add all values in the Symbology pane")
    print(f"  {lyr.name}: Unique Values on {unique}: {classes} classes, {distinct} distinct values{note}")


def prepare_layer(lyr, unique, fields, min_scale):
    # 1. Symbology: Unique Values for layers apps identify, else Single Symbol.
    set_symbology(lyr, unique)

    # 2. Switched on (only visible layers are packaged), with a scale range:
    #    min = zoomed-out limit, max = zoomed-in limit (0 = none).
    lyr.visible = True
    lyr.minThreshold = min_scale
    lyr.maxThreshold = 0

    # 3. One label class per field, cloned from the layer's default class so
    #    it keeps a valid text symbol and placement properties.
    cim = lyr.getDefinition("V3")
    if not cim.labelClasses:
        fail(f"{lyr.name}: layer has no label class to copy; "
                         "open Labeling once in Pro so it creates the default class.")
    template = cim.labelClasses[0]
    classes = []
    for field in fields:
        lc = copy.deepcopy(template)
        lc.name = field
        lc.expression = f"$feature.{field}"
        lc.expressionEngine = "Arcade"
        lc.visibility = True
        lc.minimumScale = min_scale
        lc.maximumScale = 0
        classes.append(lc)
    cim.labelClasses = classes
    cim.labelVisibility = True
    lyr.setDefinition(cim)
    print(f"  {lyr.name}: min scale {min_scale or 'none'}, label fields {fields}")


def main():
    aprx = arcpy.mp.ArcGISProject(PROJECT)
    m = find_map(aprx)
    print(f"Map: {m.name}")
    print(f"Feature layers in map: {[l.name for l in m.listLayers() if l.isFeatureLayer]}")
    index = None
    if INDEX_LAYER:
        index = find_layer(m, INDEX_LAYER)
        index.visible = False
        print(f"  {index.name}: tile index -- switched off, used as index_polygons")
    for name, cfg in LAYERS.items():
        print(f"Preparing {name}...")
        lyr = find_layer(m, name)
        unique = cfg["unique"] and existing_fields(lyr, cfg["unique"])
        prepare_layer(lyr, unique, existing_fields(lyr, cfg["fields"]), cfg["min_scale"])

    os.makedirs(os.path.dirname(OUTPUT_APRX), exist_ok=True)
    aprx.saveACopy(OUTPUT_APRX)
    print(f"Saved prepared project copy: {OUTPUT_APRX}")

    if TEST_PACKAGE:
        print("Building test package (zooms 0-7)...")
        if os.path.exists(TEST_PACKAGE):
            os.remove(TEST_PACKAGE)
        arcpy.management.CreateVectorTilePackage(
            in_map=m,
            output_file=TEST_PACKAGE,
            service_type="ONLINE",          # ArcGIS Online / Google tiling scheme
            tile_structure="INDEXED",
            min_cached_scale=295828763.7957775,
            max_cached_scale=TEST_MAX_SCALE,
            index_polygons=index,
            summary="WB GAD ADM0/1/2 + NDLSA -- attribute test",
            tags="World Bank, GAD, boundaries, test",
        )
        print(f"Test package: {TEST_PACKAGE}")


if __name__ == "__main__":
    main()
