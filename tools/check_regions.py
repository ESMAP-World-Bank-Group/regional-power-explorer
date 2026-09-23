"""
Checks that the two region registries agree.

data-source/regions.yaml drives the Python pipeline; public/data/regions.json drives
the app. They are maintained by hand and nothing regenerates one from the other, so a
region added to one and forgotten in the other fails silently: the pipeline builds
cache files nobody loads, or the app advertises a region with no data behind it.

Usage:
    python tools/check_regions.py        # exits 1 and prints every mismatch
"""
import json
import sys
from pathlib import Path

import yaml

_ROOT = Path(__file__).resolve().parents[1]
YAML_PATH = _ROOT / "data-source" / "regions.yaml"
JSON_PATH = _ROOT / "public" / "data" / "regions.json"

# Fields that must be identical on both sides. min_kv is pipeline-only and center,
# parent, type, subregions and non_determined are app-only, so none of them qualify.
SHARED_FIELDS = ["name", "status", "color"]

errors = []


def fail(msg):
    errors.append(msg)


def isos(region):
    return [c["iso"] for c in region.get("countries", [])]


def main():
    with open(YAML_PATH, encoding="utf-8") as f:
        y_regions = yaml.safe_load(f)["regions"]
    with open(JSON_PATH, encoding="utf-8") as f:
        j_regions = json.load(f)["regions"]

    y_by_id = {r["id"]: r for r in y_regions}
    j_by_id = {r["id"]: r for r in j_regions}

    if len(y_by_id) != len(y_regions):
        fail("regions.yaml has duplicate ids")
    if len(j_by_id) != len(j_regions):
        fail("regions.json has duplicate ids")

    meta_ids = {r["id"] for r in j_regions if r.get("type") == "meta"}

    # A meta-region groups regions that already exist; it has no pipeline of its own,
    # so it is the one kind of entry allowed to be missing from the yaml.
    for rid in sorted(set(j_by_id) - set(y_by_id) - meta_ids):
        fail(f"{rid}: in regions.json but not in regions.yaml (and not type: meta)")
    for rid in sorted(set(y_by_id) - set(j_by_id)):
        fail(f"{rid}: in regions.yaml but not in regions.json, so the app cannot show it")

    for rid in sorted(set(y_by_id) & set(j_by_id)):
        y, j = y_by_id[rid], j_by_id[rid]
        for field in SHARED_FIELDS:
            if y.get(field) != j.get(field):
                fail(f"{rid}.{field}: yaml={y.get(field)!r} json={j.get(field)!r}")
        y_isos, j_isos = isos(y), isos(j)
        if y_isos != j_isos:
            only_y = sorted(set(y_isos) - set(j_isos))
            only_j = sorted(set(j_isos) - set(y_isos))
            if only_y or only_j:
                fail(f"{rid}.countries: only in yaml={only_y} only in json={only_j}")
            else:
                fail(f"{rid}.countries: same set, different order "
                     f"(yaml starts {y_isos[:3]}, json starts {j_isos[:3]})")
        y_names = {c["iso"]: c["name"] for c in y.get("countries", [])}
        for c in j.get("countries", []):
            if c["iso"] in y_names and y_names[c["iso"]] != c["name"]:
                fail(f"{rid}.{c['iso']}: name yaml={y_names[c['iso']]!r} json={c['name']!r}")

    # A meta-region must list exactly what its members list, or the map and the
    # country pages disagree about who belongs to it.
    for r in j_regions:
        if r.get("type") != "meta":
            continue
        subs = r.get("subregions", [])
        if not subs:
            fail(f"{r['id']}: type meta but no subregions")
            continue
        missing = [s for s in subs if s not in j_by_id]
        if missing:
            fail(f"{r['id']}.subregions: unknown ids {missing}")
            continue
        union = set()
        for s in subs:
            union |= set(isos(j_by_id[s]))
        own = set(isos(r))
        if own != union:
            fail(f"{r['id']}: countries do not match its subregions "
                 f"(extra={sorted(own - union)} missing={sorted(union - own)})")

    # CountryPage resolves a country by scanning regions.json in order and taking the
    # first non-meta match. Overlaps are intended (a country can sit in several pools),
    # so this is not an error, but the order decides which region a country page shows.
    # Printing it keeps that consequence visible when someone reorders the file.
    seen, overlaps = {}, []
    for r in j_regions:
        if r.get("type") == "meta":
            continue
        for iso in isos(r):
            if iso in seen:
                overlaps.append((iso, seen[iso], r["id"]))
            else:
                seen[iso] = r["id"]

    if errors:
        print(f"{len(errors)} problem(s) between regions.yaml and regions.json:")
        for e in errors:
            print("  -", e)
        return 1

    n_meta = len(meta_ids)
    print(f"OK: {len(y_regions)} regions match across both files "
          f"({n_meta} meta-region(s) in the app only), {len(seen)} distinct countries.")
    if overlaps:
        print(f"{len(overlaps)} country/region overlap(s); the country page shows the "
              f"first region listed in regions.json:")
        for iso, first, later in overlaps:
            print(f"  - {iso}: {first} (shown) also in {later}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
