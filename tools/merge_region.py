"""
Build a consolidated region by merging already-prepared per-region cache files.

Instead of re-querying the heavy worldwide.gpkg, this concatenates the existing
public/data/cache/region_*_{src}.* files of several source regions into a single
consolidated region, de-duplicating entities that belong to countries shared by
more than one source pool (e.g. COD and TZA sit in both EAPP and SAPP).

Usage:
    python tools/merge_region.py --out easa --sources eapp sapp
"""
import argparse
import json
from pathlib import Path

CACHE = Path(__file__).resolve().parents[1] / "public" / "data" / "cache"

# Plant file variants (suffix appended after the region id)
PLANT_SUFFIXES = ["", "_gem", "_gppd"]
CAPACITY_SUFFIXES = ["", "_gem", "_gppd"]


def _load(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path, data):
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False),
                    encoding="utf-8")
    print(f"  {path.name}  ({path.stat().st_size/1024:.0f} KB)")


def _coords_key(coords):
    """Stable key for a coordinate list, rounded to ~1 m."""
    return tuple((round(x, 5), round(y, 5)) for x, y in coords)


def merge_plants(out_id, sources, suffix):
    """Union by country partition: each country is contributed by the first source
    that contains it, keeping that source's plants verbatim (internal duplicate
    units are real and preserved). Plants without a country fall back to a
    coordinate-based de-dup across sources."""
    claimed, coord_seen, features = set(), set(), []
    found = False
    for src in sources:
        d = _load(CACHE / f"region_plants_{src}{suffix}.geojson")
        if d is None:
            continue
        found = True
        src_countries = set()
        for f in d["features"]:
            p = f["properties"]
            country = p.get("country")
            if country:
                src_countries.add(country)
                if country in claimed:
                    continue
                features.append(f)
            else:
                lon, lat = f["geometry"]["coordinates"]
                ck = (round(lon, 5), round(lat, 5), p.get("fuel"), p.get("mw"))
                if ck in coord_seen:
                    continue
                coord_seen.add(ck)
                features.append(f)
        claimed |= src_countries
    if not found:
        return
    for i, f in enumerate(features):
        f["id"] = i
    _write(CACHE / f"region_plants_{out_id}{suffix}.geojson",
           {"type": "FeatureCollection", "features": features})


def merge_lines(out_id, sources):
    seen, features = set(), []
    found = False
    for src in sources:
        d = _load(CACHE / f"region_lines_{src}.geojson")
        if d is None:
            continue
        found = True
        for f in d["features"]:
            key = _coords_key(f["geometry"]["coordinates"])
            if key in seen:
                continue
            seen.add(key)
            features.append(f)
    if not found:
        return
    _write(CACHE / f"region_lines_{out_id}.geojson",
           {"type": "FeatureCollection", "features": features})


def merge_substations(out_id, sources):
    seen, features = set(), []
    found = False
    for src in sources:
        d = _load(CACHE / f"region_substations_{src}.geojson")
        if d is None:
            continue
        found = True
        for f in d["features"]:
            p = f["properties"]
            lon, lat = f["geometry"]["coordinates"]
            key = (p.get("name"), round(lon, 5), round(lat, 5), p.get("v"))
            if key in seen:
                continue
            seen.add(key)
            features.append(f)
    if not found:
        return
    _write(CACHE / f"region_substations_{out_id}.geojson",
           {"type": "FeatureCollection", "features": features})


def merge_capacity(out_id, sources, suffix):
    """Country-keyed; shared countries are identical across pools, so first wins."""
    countries, found = {}, False
    for src in sources:
        d = _load(CACHE / f"region_capacity_{src}{suffix}.json")
        if d is None:
            continue
        found = True
        for iso, fuels in d.get("countries", {}).items():
            countries.setdefault(iso, fuels)
    if not found:
        return
    _write(CACHE / f"region_capacity_{out_id}{suffix}.json", {"countries": countries})


def merge_age(out_id, sources):
    countries, ref_year, found = {}, None, False
    for src in sources:
        d = _load(CACHE / f"region_age_{src}_gppd.json")
        if d is None:
            continue
        found = True
        ref_year = ref_year or d.get("reference_year")
        for iso, v in d.get("countries", {}).items():
            countries.setdefault(iso, v)
    if not found:
        return
    _write(CACHE / f"region_age_{out_id}_gppd.json",
           {"reference_year": ref_year, "countries": countries})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="Consolidated region id (e.g. easa)")
    ap.add_argument("--sources", nargs="+", required=True,
                    help="Source region ids to merge (e.g. eapp sapp)")
    args = ap.parse_args()

    print(f"\nMerging {args.sources} -> {args.out}")
    for suf in PLANT_SUFFIXES:
        merge_plants(args.out, args.sources, suf)
    merge_lines(args.out, args.sources)
    merge_substations(args.out, args.sources)
    for suf in CAPACITY_SUFFIXES:
        merge_capacity(args.out, args.sources, suf)
    merge_age(args.out, args.sources)
    print("Done.")
