"""
Uzbekistan enrichment pipeline.

Runs AFTER owid_pipeline.py — reads the existing supply/UZB.json and
adds a capacity block using SIAT (stat.uz) indicator JSONs, which have
installed capacity data not available in OWID.

Also overrides solar and wind generation GWh with SIAT values, which are
more accurate than OWID for Uzbekistan.

Sources:
  Capacity (MW): National Statistics Committee of Uzbekistan — SIAT portal
                 (siat.stat.uz, indicator set 1.02.02)
  Generation:    Same SIAT portal for solar (446) and wind (458) GWh

Local data (data-source/raw/UZB/):
  sdmx_data_588.json — Total installed capacity (MW)
  sdmx_data_380.json — Hydro installed capacity (MW)
  sdmx_data_376.json — Thermal installed capacity (MW)
  sdmx_data_446.json — Solar electricity production (GWh)
  sdmx_data_458.json — Wind electricity production (GWh)

Outputs:
  public/data/supply/UZB.json  (enriched — capacity block added)
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT    = Path(__file__).resolve().parents[2]
RAW_UZB = ROOT / 'data-source' / 'raw' / 'UZB'
SUPPLY  = ROOT / 'public' / 'data' / 'supply' / 'UZB.json'

YEARS = list(range(2015, 2024))

# SIAT JSON file → (label for chart, unit)
SIAT_CAPACITY = {
    'sdmx_data_588.json': ('Total',   'MW'),
    'sdmx_data_380.json': ('Hydro',   'MW'),
    'sdmx_data_376.json': ('Thermal', 'MW'),
}

SIAT_GEN_OVERRIDE = {
    'sdmx_data_446.json': 'Solar',
    'sdmx_data_458.json': 'Wind',
}


def _read_siat(filename: str) -> dict[int, float]:
    """Parse a SIAT JSON file, returning {year: value}."""
    path = RAW_UZB / filename
    if not path.exists():
        print(f'  [UZB] missing SIAT file: {filename}')
        return {}
    raw = json.loads(path.read_text(encoding='utf-8'))
    # Structure: list with one element: {"metadata": [...], "data": [{year: value}]}
    data_rows = raw[0].get('data', [])
    if not data_rows:
        return {}
    row = data_rows[0]
    result: dict[int, float] = {}
    for key, val in row.items():
        try:
            yr = int(key)
            result[yr] = float(val)
        except (ValueError, TypeError):
            pass
    return result


def _series(data: dict[int, float], years: list[int]) -> list[float]:
    return [round(data.get(yr, 0.0), 1) for yr in years]


def run() -> None:
    print('[UZB] Uzbekistan enrichment pipeline')

    if not SUPPLY.exists():
        print('  supply/UZB.json not found — run owid_pipeline first')
        return

    supply = json.loads(SUPPLY.read_text(encoding='utf-8'))

    # ── Capacity block ──────────────────────────────────────────────────────
    cap_data: dict[str, list[float]] = {}
    for filename, (label, _unit) in SIAT_CAPACITY.items():
        raw = _read_siat(filename)
        if raw:
            series = _series(raw, YEARS)
            if any(v > 0 for v in series):
                cap_data[label] = series
                print(f'  [UZB] capacity {label}: {series[-1]:.0f} MW (2023)')

    # Derive "Solar+Wind" as residual: total - hydro - thermal
    if all(k in cap_data for k in ('Total', 'Hydro', 'Thermal')):
        cap_data['Solar+Wind'] = [
            round(cap_data['Total'][i] - cap_data['Hydro'][i] - cap_data['Thermal'][i], 1)
            for i in range(len(YEARS))
        ]
        print(f'  [UZB] capacity Solar+Wind (residual): '
              f'{cap_data["Solar+Wind"][-1]:.0f} MW (2023)')
        # Drop the Total series — chart shows breakdown, not total
        del cap_data['Total']

    supply['capacity'] = {
        'source': (
            'National Statistics Committee of Uzbekistan — SIAT portal '
            '(siat.stat.uz, indicators 1.02.02.0001/0002/0003)'
        ),
        'unit':  'MW',
        'note':  (
            'Thermal = all thermal (gas, coal, oil not distinguished). '
            'Solar+Wind = Total - Hydro - Thermal (residual).'
        ),
        'years': YEARS,
        'fuels': cap_data,
    }

    # ── Generation override: solar + wind from SIAT (GWh) ──────────────────
    gen_fuels = supply.get('generation', {}).get('fuels', {})
    for filename, label in SIAT_GEN_OVERRIDE.items():
        raw = _read_siat(filename)
        if not raw:
            continue
        series = _series(raw, YEARS)
        if any(v > 0 for v in series):
            gen_fuels[label] = series
            print(f'  [UZB] gen override {label}: {series[-1]:.1f} GWh (2023)')

    supply['generation']['fuels'] = gen_fuels
    supply['generation']['source'] = (
        'Our World in Data / Ember (fuel mix base); '
        'solar and wind GWh overridden with SIAT (siat.stat.uz, indicators 1.02.02.0006/0007)'
    )

    SUPPLY.write_text(json.dumps(supply, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'  supply -> {SUPPLY}')


if __name__ == '__main__':
    run()
