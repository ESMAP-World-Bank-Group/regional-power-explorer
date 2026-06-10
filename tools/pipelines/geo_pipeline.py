"""
Georgia supply pipeline.

Downloads ESCO annual electricity balance PDFs from:
  https://esco.ge/files/data/Balance/energobalans_{year}_eng.pdf

Extracts annual generation by category (GWh):
  Hydro Reservoir — Regulatory HPPs (Enguri, Vardnil, Khrami, Zhinval, ...)
  Hydro RoR       — Seasonal HPPs + Small power HPPs
  Gas             — all thermal in Georgia is gas-fired
  Wind            — Kartli WPP (single plant through 2024)

Demand estimated as: generation + imports - exports (from same PDF).

Outputs:
  public/data/supply/GEO.json

Note: Capacity data (MW) not available from ESCO balance PDFs.
"""
import json
import requests
import pdfplumber
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW  = ROOT / 'data-source' / 'raw' / 'GEO'
OUT_SUPPLY = ROOT / 'public' / 'data' / 'supply' / 'GEO.json'

BASE_URL = 'https://esco.ge/files/data/Balance/energobalans_{year}_eng.pdf'
YEARS    = list(range(2017, 2026))


def _download(year):
    path = RAW / f'esco_energobalans_{year}.pdf'
    if path.exists():
        return path
    url = BASE_URL.format(year=year)
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    RAW.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    print(f'  downloaded {url}')
    return path


def _num(s):
    if not s or not str(s).strip():
        return None
    try:
        # Old PDFs (2017-2021) use space as thousands separator: '11 530.4'
        # New PDFs (2022+) use comma: '1,174.902'
        return float(str(s).replace(',', '').replace(' ', '').strip())
    except ValueError:
        return None


def _is_subrow(name):
    return name.startswith('-') or name.startswith('–') or name.startswith(' -')


def _parse_pdf(path):
    """Return dict of annual totals (GWh) for key categories."""
    out = {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            tbl = page.extract_table()
            if not tbl:
                continue
            for row in tbl:
                if not row or not row[0]:
                    continue
                raw_name = str(row[0]).strip()
                name = raw_name.lower()
                if _is_subrow(raw_name):
                    continue
                val = _num(row[-1])
                if val is None:
                    continue

                if 'total generation' in name and 'hydro' not in name:
                    out['generation'] = val
                elif name.startswith('total thermal'):
                    out['gas'] = val
                elif 'wind' in name and ('kartli' in name or 'total wind' in name or 'wind power' in name):
                    out['wind'] = val
                elif 'regulatory' in name:
                    out['hydro_reservoir'] = val
                elif 'seasonal' in name:
                    out.setdefault('_ror_seasonal', val)
                elif 'small power' in name:
                    out.setdefault('_ror_small', val)
                elif name.startswith('total import'):
                    out['imports'] = val
                elif name.startswith('total export'):
                    out['exports'] = val

    # Combine RoR components
    ror = (out.pop('_ror_seasonal', 0) or 0) + (out.pop('_ror_small', 0) or 0)
    if ror > 0:
        out['hydro_ror'] = round(ror, 1)

    return out


def run():
    RAW.mkdir(parents=True, exist_ok=True)

    records = []
    for year in YEARS:
        print(f'{year} ...', end=' ')
        try:
            path = _download(year)
            data = _parse_pdf(path)
        except Exception as e:
            print(f'SKIP ({e})')
            continue

        if not data.get('generation'):
            print('SKIP (no generation row found)')
            continue

        gen   = data.get('generation', 0) or 0
        imp   = data.get('imports',    0) or 0
        exp   = data.get('exports',    0) or 0
        demand = round(gen + imp - exp, 1)
        data['demand'] = demand
        records.append({'year': year, **data})
        print(
            f"{gen:.0f} GWh  "
            f"(res={data.get('hydro_reservoir',0):.0f}  "
            f"ror={data.get('hydro_ror',0):.0f}  "
            f"gas={data.get('gas',0):.0f}  "
            f"wind={data.get('wind',0):.0f})"
        )

    if not records:
        print('No data extracted — aborting.')
        return

    def col(key):
        return [round(r.get(key) or 0, 1) for r in records]

    supply = {
        'country': 'Georgia',
        'generation': {
            'source': 'ESCO Georgia — Annual Electricity Balance (energobalans_YYYY_eng.pdf)',
            'unit': 'GWh',
            'note': (
                'All thermal is gas-fired. '
                'Hydro Reservoir = Regulatory HPPs (Enguri, Vardnil, Khrami, Zhinval, etc.). '
                'Hydro RoR = Seasonal HPPs + Small power HPPs. '
                'Demand estimated as generation + imports - exports.'
            ),
            'years': [r['year'] for r in records],
            'fuels': {
                'Hydro Reservoir': col('hydro_reservoir'),
                'Hydro RoR':       col('hydro_ror'),
                'Gas':             col('gas'),
                'Wind':            col('wind'),
            },
            'demand': col('demand'),
        },
    }

    OUT_SUPPLY.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_SUPPLY, 'w', encoding='utf-8') as f:
        json.dump(supply, f, indent=2, ensure_ascii=False)
    print(f'GEO supply → {OUT_SUPPLY}')


if __name__ == '__main__':
    run()
