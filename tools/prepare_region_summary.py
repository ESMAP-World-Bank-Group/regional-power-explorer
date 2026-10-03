"""
Small per-region summaries of the map data files, so the region page can hand
the big files straight to MapLibre's worker instead of reading them itself.

The region page used to parse region_lines_<id>.geojson and
region_plants_<id>[_gppd|_gem].geojson on the main thread -- Europe's are 21 MB
and 10 MB -- and then MapLibre copied them again to its worker: about 1.3 s of
frozen page on a desktop, several seconds on a phone. All the page needs from
them up front is what is summarised here; the files themselves now go to the
map by URL, and are read in full only for a download.

Outputs (public/data/cache/):
    region_summary_<id>.json
        lines.voltages   distinct line voltages in volts (0 = untagged), for the
                         slider floor and the voltage legend
        plants.<source>  per plant source present ('osm', 'gppd', 'gem'):
                         count    number of plants
                         fuels    distinct fuel names
                         top_mw   the 151 largest capacities (MW), descending --
                                  enough for adaptiveMinMw() in src/constants.js,
                                  which caps the map at the ~150 largest plants

Run after any pipeline step that rewrites the region plant or line files:
    python tools/prepare_region_summary.py
"""
import json
import re
from pathlib import Path

CACHE = Path(__file__).resolve().parents[1] / "public" / "data" / "cache"
SOURCES = {"": "osm", "_gppd": "gppd", "_gem": "gem"}
TOP = 151


def features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f).get("features", [])


def summarise(region):
    out = {"lines": None, "plants": {}}
    lines = CACHE / f"region_lines_{region}.geojson"
    if lines.exists():
        volts = {int((f.get("properties") or {}).get("v") or 0) for f in features(lines)}
        out["lines"] = {"voltages": sorted(volts)}
    for suffix, name in SOURCES.items():
        path = CACHE / f"region_plants_{region}{suffix}.geojson"
        if not path.exists():
            continue
        feats = features(path)
        props = [f.get("properties") or {} for f in feats]
        mws = sorted((p.get("mw") or 0 for p in props if (p.get("mw") or 0) > 0), reverse=True)
        out["plants"][name] = {
            "count": len(feats),
            "fuels": sorted({p["fuel"] for p in props if p.get("fuel")}),
            "top_mw": mws[:TOP],
        }
    return out


def main():
    regions = sorted({m.group(1) for p in CACHE.glob("region_*.geojson")
                      if (m := re.match(r"region_(?:lines|plants)_(.+?)(?:_gppd|_gem)?\.geojson$", p.name))})
    for region in regions:
        summary = summarise(region)
        path = CACHE / f"region_summary_{region}.json"
        path.write_text(json.dumps(summary, separators=(",", ":")), encoding="utf-8")
        print(f"{path.name}: {path.stat().st_size} B, sources {list(summary['plants'])}")


if __name__ == "__main__":
    main()
