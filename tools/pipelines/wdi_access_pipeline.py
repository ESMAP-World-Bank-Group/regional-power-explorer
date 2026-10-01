"""
Electricity access pipeline (World Bank WDI).

Generates public/data/access.json for every country in data-source/regions.yaml.
Replaces a hand-maintained file that covered 87 of them and was frozen at 2022, so
any region added later silently showed no access figures.

Indicators:
  EG.ELC.ACCS.ZS      access to electricity, % of population
  EG.ELC.ACCS.UR.ZS   access to electricity, urban % of urban population
  EG.ELC.ACCS.RU.ZS   access to electricity, rural % of rural population

Source:
  World Bank World Development Indicators (CC BY 4.0), api.worldbank.org/v2

Each country keeps its own latest year with a total value, which is what SE4All
reports: a country missing from the newest release keeps its last good reading
instead of dropping out of the file. The headline year written at the top is the
most common of those, so the app label matches what most of the map shows.

Usage:
  python tools/pipelines/wdi_access_pipeline.py
  python tools/pipelines/wdi_access_pipeline.py --dry-run   # print, do not write
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
REGIONS = ROOT / "data-source" / "regions.yaml"
OUT = ROOT / "public" / "data" / "access.json"

API = "https://api.worldbank.org/v2/country/all/indicator/{ind}"
INDICATORS = {"total": "EG.ELC.ACCS.ZS",
              "urban": "EG.ELC.ACCS.UR.ZS",
              "rural": "EG.ELC.ACCS.RU.ZS"}

FIRST_YEAR = 2000
PER_PAGE = 20000

# regions.yaml follows the boundary file's codes; WDI follows its own in a few places.
ISO_ALIASES = {"XKX": "KOS"}

# WDI carries no access series for Kosovo at all, under either code. It is universally
# electrified and was in the hand-maintained file this pipeline replaces, so it is
# carried over rather than dropped. Remove the entry if WDI ever publishes the series.
OVERRIDES = {
    "KOS": {"total": 100.0, "urban": 100.0, "rural": 100.0, "year": 2022,
            "source": "carried over from the previous hand-maintained access.json"},
}


def wanted_isos() -> set[str]:
    with open(REGIONS, encoding="utf-8") as f:
        regions = yaml.safe_load(f)["regions"]
    return {c["iso"] for r in regions for c in r.get("countries", [])}


def fetch(indicator: str) -> dict[str, dict[int, float]]:
    """Returns {iso3: {year: value}} for one indicator, newest release first."""
    url = (f"{API.format(ind=indicator)}?format=json&per_page={PER_PAGE}"
           f"&date={FIRST_YEAR}:2100")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as resp:
                payload = json.loads(resp.read())
            break
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 2:
                raise SystemExit(f"  ! {indicator}: {e}")
            time.sleep(2 * (attempt + 1))

    if not isinstance(payload, list) or len(payload) < 2 or payload[1] is None:
        raise SystemExit(f"  ! {indicator}: unexpected API response")

    out: dict[str, dict[int, float]] = collections.defaultdict(dict)
    for row in payload[1]:
        if row.get("value") is None:
            continue
        iso = (row.get("countryiso3code") or "").upper()
        # The "all countries" endpoint also returns aggregates (WLD, ARB, EUU...).
        # They carry a real ISO3-looking code, so filtering on the region registry
        # below is what actually keeps them out.
        if len(iso) != 3:
            continue
        iso = ISO_ALIASES.get(iso, iso)
        out[iso][int(row["date"])] = float(row["value"])
    print(f"  {indicator}: {len(out)} economies, "
          f"latest {max((max(v) for v in out.values()), default='n/a')}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="print the summary without writing access.json")
    args = ap.parse_args()

    isos = wanted_isos()
    print(f"=== WDI access pipeline === ({len(isos)} countries in regions.yaml)")

    series = {key: fetch(ind) for key, ind in INDICATORS.items()}

    countries: dict[str, dict] = {}
    years_used: list[int] = []
    for iso in sorted(isos):
        totals = series["total"].get(iso)
        if not totals:
            continue
        year = max(totals)
        entry = {"total": round(totals[year], 1)}
        # Urban and rural can lag the headline series by a year; take each one's own
        # latest rather than dropping the pair when they are not perfectly aligned.
        for key in ("urban", "rural"):
            vals = series[key].get(iso)
            if vals:
                entry[key] = round(vals[max(vals)], 1)
        entry["year"] = year
        countries[iso] = entry
        years_used.append(year)

    for iso, entry in OVERRIDES.items():
        if iso in isos and iso not in countries:
            countries[iso] = dict(entry)
            print(f"  {iso}: no WDI series, using the documented override")
    countries = {k: countries[k] for k in sorted(countries)}

    missing = sorted(isos - set(countries))
    headline = collections.Counter(years_used).most_common(1)[0][0]

    doc = {
        "year": headline,
        "source": "World Bank WDI (EG.ELC.ACCS.ZS) / SE4All",
        "note": ("% of population with access to electricity. Each country carries "
                 "its own reference year; the headline year is the most common one."),
        "countries": countries,
    }

    print(f"  {len(countries)} countries written, headline year {headline}")
    spread = collections.Counter(years_used)
    print("  years: " + ", ".join(f"{y}: {n}" for y, n in sorted(spread.items())))
    if missing:
        print(f"  no WDI access series for {len(missing)}: {', '.join(missing)}")

    if args.dry_run:
        print("  (dry run, nothing written)")
        return 0

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"  -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
