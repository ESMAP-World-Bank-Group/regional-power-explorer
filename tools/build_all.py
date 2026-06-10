"""
Run all country data pipelines and regenerate public/data/ JSON files.

Usage:
  conda activate gams_env

  # All pipelines (ENTSO-E is slow on first run, fast thereafter):
  python tools/build_all.py

  # Skip ENTSO-E (quick local-file pipelines only):
  python tools/build_all.py --no-entsoe

  # ENTSO-E only, specific countries:
  python tools/build_all.py --entsoe-only BG RO GR

Pipelines:
  TUR  — TEİAS XLS -> supply/TUR.json + trade/TUR.json
  AZE  — SSC XLS + CSV -> supply/AZE.json + trade/AZE.json
  GEO  — ESCO PDFs + TYNDP xlsx -> supply/GEO.json
  ENTSO-E — ENTSO-E API -> supply/{ISO3}.json for 36 countries
             First run ~30-60 min; subsequent runs use cached CSVs (instant).
             Cache: data-source/raw/ENTSOE/  (gitignored)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pipelines import tur_pipeline, aze_pipeline, geo_pipeline, entsoe_supply_pipeline

if __name__ == '__main__':
    args = sys.argv[1:]
    no_entsoe   = '--no-entsoe'   in args
    entsoe_only = '--entsoe-only' in args
    entsoe_countries = [a for a in args if not a.startswith('--')] or None

    if not entsoe_only:
        print('=== TUR pipeline ===')
        tur_pipeline.run()
        print()
        print('=== AZE pipeline ===')
        aze_pipeline.run()
        print()
        print('=== GEO pipeline ===')
        geo_pipeline.run()
        print()

    if not no_entsoe:
        print('=== ENTSO-E pipeline ===')
        entsoe_supply_pipeline.run(iso2_filter=entsoe_countries)
        print()

    print('Done.')
