"""
EAPP (Eastern Africa Power Pool) trade pipeline.

Reads data-source/raw/EAPP/eapp_interconnections.csv and generates
public/data/trade/{ISO3}.json for each EAPP country.

CSV format: from_iso, to_iso, <year>, <year>, ...
Each row = one directed bilateral flow from_iso → to_iso, net annual GWh.
Source: EAPP Annual Reports / Secretariat.

The KEN–UGA row is encoded as KEN→UGA (Kenya net exporter to Uganda)
based on typical EAPP flows; update the CSV if direction is confirmed.

Usage:
  python tools/pipelines/eapp_trade_pipeline.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT      = Path(__file__).resolve().parents[2]
RAW_EAPP  = ROOT / 'data-source' / 'raw' / 'EAPP' / 'eapp_interconnections.csv'
OUT_TRADE = ROOT / 'public' / 'data' / 'trade'

ISO3_NAMES = {
    'EGY': 'Egypt',
    'LBY': 'Libya',
    'SDN': 'Sudan',
    'SSD': 'South Sudan',
    'ETH': 'Ethiopia',
    'DJI': 'Djibouti',
    'KEN': 'Kenya',
    'TZA': 'Tanzania',
    'SOM': 'Somalia',
    'UGA': 'Uganda',
    'RWA': 'Rwanda',
    'BDI': 'Burundi',
    'COD': 'DR Congo',
}


def run(countries: list[str] | None = None) -> None:
    df = pd.read_csv(RAW_EAPP)
    year_cols = [c for c in df.columns if c.isdigit()]
    years = [int(y) for y in year_cols]

    # Collect all ISO3 codes present in the data
    all_iso = sorted(set(df['from_iso'].tolist()) | set(df['to_iso'].tolist()))
    if countries:
        all_iso = [c for c in all_iso if c in countries]

    OUT_TRADE.mkdir(parents=True, exist_ok=True)

    for iso3 in all_iso:
        name = ISO3_NAMES.get(iso3, iso3)

        # Exports: rows where this country is the sender
        exp_rows = df[df['from_iso'] == iso3]
        exports: dict[str, list[float]] = {}
        for _, row in exp_rows.iterrows():
            partner = ISO3_NAMES.get(row['to_iso'], row['to_iso'])
            exports[partner] = [float(row[y]) for y in year_cols]

        # Imports: rows where this country is the receiver
        imp_rows = df[df['to_iso'] == iso3]
        imports: dict[str, list[float]] = {}
        for _, row in imp_rows.iterrows():
            partner = ISO3_NAMES.get(row['from_iso'], row['from_iso'])
            imports[partner] = [float(row[y]) for y in year_cols]

        if not exports and not imports:
            continue

        trade = {
            'country': name,
            'unit':    'GWh',
            'source':  'EAPP Secretariat — Annual Interconnection Statistics (net annual flows)',
            'years':   years,
            'exports': exports,
            'imports': imports,
        }

        out_path = OUT_TRADE / f'{iso3}.json'
        out_path.write_text(json.dumps(trade, indent=2, ensure_ascii=False), encoding='utf-8')

        exp_total = sum(sum(v) for v in exports.values())
        imp_total = sum(sum(v) for v in imports.values())
        print(f'  [{iso3}] {name}: exports {len(exports)} partners '
              f'({exp_total:.0f} GWh)  imports {len(imports)} partners ({imp_total:.0f} GWh)'
              f'  -> {out_path.name}')


if __name__ == '__main__':
    iso3_filter = [a for a in sys.argv[1:] if not a.startswith('--')]
    print('=== EAPP trade pipeline ===')
    run(countries=iso3_filter or None)
    print('Done.')
