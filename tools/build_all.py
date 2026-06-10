"""
Run all country data pipelines and regenerate public/data/ JSON files.

Usage:
  conda activate gams_env
  python tools/build_all.py

Pipelines:
  TUR — TEİAŞ XLS → supply/TUR.json + trade/TUR.json
  AZE — SSC XLS + CSV → supply/AZE.json + trade/AZE.json
  GEO — trade/GEO.json (pre-generated, pipeline pending Phase 3)
"""
import sys
from pathlib import Path

# Allow running from repo root or tools/
sys.path.insert(0, str(Path(__file__).parent))

from pipelines import tur_pipeline, aze_pipeline

if __name__ == '__main__':
    print('=== TUR pipeline ===')
    tur_pipeline.run()
    print()
    print('=== AZE pipeline ===')
    aze_pipeline.run()
    print()
    print('Done. GEO trade JSON is pre-generated (Phase 3 pending).')
