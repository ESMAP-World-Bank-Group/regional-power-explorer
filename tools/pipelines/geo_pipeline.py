"""
Georgia supply pipeline.

Generation data:
  Downloads ESCO annual electricity balance PDFs from:
    https://esco.ge/files/data/Balance/energobalans_{year}_eng.pdf
  Extracts annual generation by category (GWh):
    Hydro Reservoir — Regulatory HPPs (Enguri, Vardnil, Khrami, Zhinval, ...)
    Hydro RoR       — Seasonal HPPs + Small power HPPs
    Gas             — all thermal in Georgia is gas-fired
    Wind            — Kartli WPP (single plant through 2024)
  Demand estimated as: generation + imports - exports (from same PDF).

Capacity data:
  Reads from data-source/raw/GEO/tyndp2022_capacity.xlsx
  Source: GSE / World Bank Power Sector Data Repository, TYNDP 2022 basis
  Coverage: 2017-2021 (official). 2022-2025 extrapolated from confirmed additions:
    - GNERC Annual Report 2024: +47.5 MW HPPs commissioned in 2024
    - Gardabani TP 2 (255 MW) added 2020 — captured in TYNDP data
  Categories: Hydro Reservoir (large + daily-regulation HPPs), Hydro RoR (seasonal + small HPPs),
              Gas (all thermal), Wind (Kartli WPP)

Outputs:
  public/data/supply/GEO.json
"""
import json
import requests
import pandas as pd
import pdfplumber
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW  = ROOT / 'data-source' / 'raw' / 'GEO'
OUT_SUPPLY = ROOT / 'public' / 'data' / 'supply' / 'GEO.json'

BASE_URL = 'https://esco.ge/files/data/Balance/energobalans_{year}_eng.pdf'
YEARS    = list(range(2017, 2026))


# ─── Capacity from TYNDP 2022 xlsx ───────────────────────────────────────────

def _build_capacity():
    """Read capacity series from TYNDP xlsx (official 2017-2021) and extend to 2025."""
    xl   = pd.ExcelFile(RAW / 'tyndp2022_capacity.xlsx')
    df   = xl.parse('Installed Capacity', header=None)

    # Row 3 contains years; data rows start at row 5
    year_row  = df.iloc[3]
    col_years = {int(y): c for c, y in year_row.items() if isinstance(y, float) and not pd.isna(y)}

    # Integer row indices within df
    R_RESERVOIR = 5   # Reservoir Hydro
    R_DAILY_REG = 6   # Daily Regulation Hydro
    R_ROR       = 7   # Run-of-River
    R_SMALL     = 8   # Run-of-River (Small)
    R_THERMAL   = 9   # Thermal (all gas in Georgia)
    R_WIND      = 10  # Wind

    def cell(row_idx, year):
        col = col_years.get(year)
        if col is None:
            return 0.0
        val = df.iloc[row_idx, col]
        try:
            return float(val)
        except Exception:
            return 0.0

    # Official 2017-2021
    official = {}
    for yr in range(2017, 2022):
        official[yr] = {
            'Hydro Reservoir': round(cell(R_RESERVOIR, yr) + cell(R_DAILY_REG, yr), 1),
            'Hydro RoR':       round(cell(R_ROR, yr)       + cell(R_SMALL, yr),      1),
            'Gas':             round(cell(R_THERMAL, yr), 1),
            'Wind':            round(cell(R_WIND, yr),    1),
        }

    # 2022-2025 estimates based on trend + known additions
    # Reservoir: stable (no new large HPPs)
    # RoR+Small: ~30-47 MW/year (GNERC 2024 confirms +47.5 MW in 2024)
    # Thermal: stable (no new gas plants through 2025)
    # Wind: stable (Kartli only; Kartsakhi 147 MW not yet built)
    base_res = official[2021]['Hydro Reservoir']   # 2381.1
    base_ror = official[2021]['Hydro RoR']         # 972.8
    base_gas = official[2021]['Gas']               # 1189.1
    base_wnd = official[2021]['Wind']              # 20.7

    # Estimated annual RoR additions: ~30 MW (2022), ~33 MW (2023), +47.5 MW (2024, GNERC confirmed), ~30 MW (2025)
    estimates = {
        2022: {'Hydro Reservoir': base_res, 'Hydro RoR': round(base_ror + 30.0, 1),   'Gas': base_gas, 'Wind': base_wnd},
        2023: {'Hydro Reservoir': base_res, 'Hydro RoR': round(base_ror + 63.0, 1),   'Gas': base_gas, 'Wind': base_wnd},
        2024: {'Hydro Reservoir': base_res, 'Hydro RoR': round(base_ror + 110.5, 1),  'Gas': base_gas, 'Wind': base_wnd},
        2025: {'Hydro Reservoir': base_res, 'Hydro RoR': round(base_ror + 140.5, 1),  'Gas': base_gas, 'Wind': base_wnd},
    }

    merged = {**official, **estimates}
    return merged


# ─── Generation from ESCO PDFs ───────────────────────────────────────────────

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
        return float(str(s).replace(',', '').replace(' ', '').strip())
    except ValueError:
        return None


def _is_subrow(name):
    return name.startswith('-') or name.startswith('–') or name.startswith(' -')


def _parse_pdf(path):
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

    ror = (out.pop('_ror_seasonal', 0) or 0) + (out.pop('_ror_small', 0) or 0)
    if ror > 0:
        out['hydro_ror'] = round(ror, 1)
    return out


# ─── Build and write JSON ─────────────────────────────────────────────────────

def run():
    RAW.mkdir(parents=True, exist_ok=True)

    # ── Generation ──
    gen_records = []
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
        data['demand'] = round(gen + imp - exp, 1)
        gen_records.append({'year': year, **data})
        print(
            f"{gen:.0f} GWh  "
            f"(res={data.get('hydro_reservoir',0):.0f}  "
            f"ror={data.get('hydro_ror',0):.0f}  "
            f"gas={data.get('gas',0):.0f}  "
            f"wind={data.get('wind',0):.0f})"
        )

    # ── Capacity ──
    print('\nBuilding capacity from TYNDP xlsx...')
    cap_data = _build_capacity()
    cap_years = sorted(cap_data)
    for yr in cap_years:
        d = cap_data[yr]
        flag = '' if yr <= 2021 else ' (est.)'
        print(f'  {yr}{flag}: res={d["Hydro Reservoir"]:.0f}  ror={d["Hydro RoR"]:.0f}  gas={d["Gas"]:.0f}  wind={d["Wind"]:.0f}')

    # ── Assemble JSON ──
    gen_years = [r['year'] for r in gen_records]

    def gcol(key):
        return [round(r.get(key) or 0, 1) for r in gen_records]

    def ccol(key):
        return [round(cap_data[yr][key], 1) for yr in cap_years]

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
            'years': gen_years,
            'fuels': {
                'Hydro Reservoir': gcol('hydro_reservoir'),
                'Hydro RoR':       gcol('hydro_ror'),
                'Gas':             gcol('gas'),
                'Wind':            gcol('wind'),
            },
            'demand': gcol('demand'),
        },
        'capacity': {
            'source': (
                'GSE / World Bank Power Sector Data Repository — TYNDP 2022 basis (2017-2021 official). '
                '2022-2025 estimated from GNERC annual reports.'
            ),
            'unit': 'MW',
            'note': (
                'Hydro Reservoir = large reservoir HPPs + daily-regulation HPPs. '
                'Hydro RoR = seasonal run-of-river + small HPPs. '
                'Thermal is gas only (no coal in Georgia). '
                'Wind = Kartli WPP (20.7 MW, commissioned 2016). '
                '2022-2025 are estimates: +47.5 MW HPPs confirmed for 2024 (GNERC Annual Report 2024).'
            ),
            'years': cap_years,
            'fuels': {
                'Hydro Reservoir': ccol('Hydro Reservoir'),
                'Hydro RoR':       ccol('Hydro RoR'),
                'Gas':             ccol('Gas'),
                'Wind':            ccol('Wind'),
            },
        },
    }

    OUT_SUPPLY.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_SUPPLY, 'w', encoding='utf-8') as f:
        json.dump(supply, f, indent=2, ensure_ascii=False)
    print(f'\nGEO supply -> {OUT_SUPPLY}')


if __name__ == '__main__':
    run()
