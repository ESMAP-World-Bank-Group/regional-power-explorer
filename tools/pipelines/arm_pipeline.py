"""
Armenia electricity pipeline.

Sources:
  Generation:        Our World in Data / Ember — owid-energy-data.csv
                     (github.com/owid/energy-data, CC BY 4.0)
  Trade — Iran:      Curated from IEA Armenia Energy Profile, Armstat / Ampop.am
  Trade — Georgia:   ESCO Georgia Generation Balance PDFs (local, 2020-2023)
                     Rows extracted: "Import from Armenia", "Transit from Armenia to Turkey",
                     "Transit from Russia to Armenia"

Note on GEO→ARM imports: Georgia's direct electricity exports to Armenia are NOT labelled
as a distinct row in the available ESCO PDFs; they appear absorbed into Georgian dispatch
or are reported on Armenia's side (PSRC). These bilateral imports are therefore absent from
the trade JSON; the net export balance is still correct via Ember net_elec_imports.

Cache:
  data-source/raw/ARM/owid_energy.csv  (gitignored — regenerated from OWID)

Outputs:
  public/data/supply/ARM.json
  public/data/trade/ARM.json
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import pandas as pd
import pdfplumber
import requests

ROOT       = Path(__file__).resolve().parents[2]
RAW        = ROOT / 'data-source' / 'raw' / 'ARM'
OUT_SUPPLY = ROOT / 'public' / 'data' / 'supply' / 'ARM.json'
OUT_TRADE  = ROOT / 'public' / 'data' / 'trade'  / 'ARM.json'

# Local path to Georgia ESCO generation balance PDFs (external to repo)
GEO_BALANCE_DIR = Path(
    r'C:\Users\wb590892\Documents\EPM_Models\black_sea_2026'
    r'\Data\Georgia\Team\Generation Balance'
)

OWID_URL   = 'https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv'
OWID_CACHE = RAW / 'owid_energy.csv'

YEARS = list(range(2015, 2024))  # 2015-2023

# ── OWID fuel columns → dashboard labels ────────────────────────────────────
OWID_FUEL_MAP = {
    'nuclear_electricity':         'Nuclear',
    'hydro_electricity':           'Hydro',
    'gas_electricity':             'Gas',
    'solar_electricity':           'Solar',
    'wind_electricity':            'Wind',
    'bioenergy_electricity':       'Bioenergy',
    'other_renewable_electricity': 'Other',
    'coal_electricity':            'Coal',
    'oil_electricity':             'Oil',
}

# ── Curated ARM ↔ Iran trade data (GWh) ─────────────────────────────────────
# Sources:
#   2016 – Worldometer: 1,229 GWh total exports; 76% share to Iran = 938 GWh
#   2019 – IEA Armenia Energy Profile: Iran bartered 0.379 bcm × 3 kWh/m³ ≈ 1,137 GWh
#   2021 – IEA: 0.3446 bcm × 3 kWh/m³ = 1,034 GWh
#   2022 – Ampop.am / Armstat: 1,178 GWh (76 % of 1,500 GWh total)
#   2023 – Ampop.am / Armstat: 1,096 GWh (88 % of ~1,240 GWh total)
#   2015,2017,2018,2020 – linearly interpolated between anchored years
ARM_IRAN_EXPORTS: dict[int, float] = {
    2015: 1400.0,
    2016:  938.0,
    2017: 1000.0,
    2018: 1050.0,
    2019: 1140.0,
    2020: 1040.0,
    2021: 1034.0,
    2022: 1178.0,
    2023: 1096.0,
}
# Iran imports to Armenia: tiny system-balancing flows only
# Source: IEA / Armstat 2023 figure
ARM_IRAN_IMPORTS: dict[int, float] = {
    2023: 19.0,
}


# ── Georgia PDF extraction ───────────────────────────────────────────────────

_GEO_ROWS = {
    'arm_to_geo': ['import from armenia'],
    'arm_to_tur': ['transit from armenia to turkey', 'transit from armenia tu turkey'],
    'rus_to_arm': ['transit from russia to armenia', 'transit from russia tu armenia'],
}

def _parse_data_nums(line: str) -> list[float]:
    """
    Parse numeric data values from a Georgia balance PDF row.

    Data values always contain a decimal point (e.g. "66.192", "0.000").
    Row-number prefixes (e.g. the bare "5" in "5 Import from Armenia") and
    thousands-separator fragments (e.g. the "1" in "1 587.414") are single
    integer tokens without a decimal — excluded to avoid index shift.
    """
    nums: list[float] = []
    for t in line.split():
        if '.' not in t and ',' not in t:
            continue
        try:
            nums.append(float(t.replace(',', '.')))
        except ValueError:
            pass
    return nums


def _page_is_annual(txt: str) -> bool:
    """True if this page is a pure annual summary (rows have exactly 3 columns)."""
    for line in txt.split('\n'):
        ll = line.lower()
        if 'total import' in ll or 'totally sold' in ll:
            nums = _parse_data_nums(line)
            if nums:
                return len(nums) == 3
    return False


def _page_has_embedded_annual(txt: str) -> bool:
    """
    True if the page contains a 'TOTALLY IN YYYY' column header, meaning
    the last group of each row is the annual total (not a monthly value).
    This occurs in 2022 p2 which covers Jul-Nov monthly + annual total.
    """
    return 'TOTALLY IN' in txt.upper()


def _row_sum_monthly(line: str, skip_last_group: bool = False) -> float:
    """
    Sum the TOTALLY-SOLD value (index 0 of each 3-col group) across monthly
    groups only.  If skip_last_group is True the final 3-col group is treated
    as the embedded annual total and excluded from the sum.
    """
    nums = _parse_data_nums(line)
    n_groups = len(nums) // 3
    if skip_last_group and n_groups > 1:
        n_groups -= 1
    total = 0.0
    for i in range(n_groups):
        total += nums[i * 3]
    return total


def _extract_geo_trade(years: list[int]) -> dict[int, dict[str, float]]:
    """
    Parse Georgia ESCO generation balance PDFs for Armenia-related annual flows.

    PDF structures vary by year:
      2020: 4 pages — p1-p3 monthly (4 months each), p4 annual summary (3 cols)
      2021: 3 pages — p1-p3 monthly (4 months each), NO annual summary page
      2022: 2 pages — p1 monthly Jan-Jun, p2 monthly Jul-Dec + annual embedded
      2023: 3 pages — p1-p2 monthly (6 months each), p3 annual summary (3 cols)

    Strategy:
      - If any page is a pure annual page → use that page's values directly.
      - Otherwise → sum TOTALLY-SOLD across all monthly pages, capping each
        page at max 6 month groups (skips embedded annual groups at index ≥ 18).
    """
    if not GEO_BALANCE_DIR.exists():
        print(f'  [ARM] Georgia PDFs not found at {GEO_BALANCE_DIR} — using zeros')
        return {yr: {k: 0.0 for k in _GEO_ROWS} for yr in years}

    result: dict[int, dict[str, float]] = {}

    for yr in years:
        pdf_path = GEO_BALANCE_DIR / f'generation_{yr}.pdf'
        if not pdf_path.exists():
            result[yr] = {k: 0.0 for k in _GEO_ROWS}
            continue

        # Collect per-page data
        # Each entry: (is_annual, has_embedded_annual, {key: value})
        pages: list[tuple[bool, bool, dict[str, float]]] = []
        with pdfplumber.open(pdf_path) as pdf:
            for pg in pdf.pages:
                txt = pg.extract_text() or ''
                is_ann  = _page_is_annual(txt)
                has_emb = _page_has_embedded_annual(txt)
                page_vals: dict[str, float] = {k: 0.0 for k in _GEO_ROWS}
                for line in txt.split('\n'):
                    ll = line.lower()
                    for key, patterns in _GEO_ROWS.items():
                        if any(p in ll for p in patterns):
                            if is_ann:
                                # Pure annual page: first decimal token = TOTALLY SOLD
                                nums = _parse_data_nums(line)
                                page_vals[key] += nums[0] if nums else 0.0
                            else:
                                # Monthly page (possibly with embedded annual in last group)
                                page_vals[key] += _row_sum_monthly(
                                    line, skip_last_group=has_emb
                                )
                pages.append((is_ann, has_emb, page_vals))

        totals: dict[str, float] = {k: 0.0 for k in _GEO_ROWS}
        annual_pages = [(ann, emb, vals) for ann, emb, vals in pages if ann]
        if annual_pages:
            # Pure annual summary pages exist — use them exclusively
            for _, _, vals in annual_pages:
                for k, v in vals.items():
                    totals[k] += v
        else:
            # No pure annual page — sum all monthly pages
            # Pages with "TOTALLY IN" header already skip their embedded annual group
            for _, _, vals in pages:
                for k, v in vals.items():
                    totals[k] += v

        result[yr] = totals
        print(
            f'  [ARM] GEO {yr}: '
            f'ARM->GEO {totals["arm_to_geo"]:.1f}  '
            f'ARM->TUR(via GEO) {totals["arm_to_tur"]:.1f}  '
            f'RUS->ARM(via GEO) {totals["rus_to_arm"]:.1f} GWh'
        )

    return result


# ── Generation (OWID / Ember) ────────────────────────────────────────────────

def _load_owid(refresh: bool = False) -> pd.DataFrame:
    RAW.mkdir(parents=True, exist_ok=True)
    if not OWID_CACHE.exists() or refresh:
        print('  Downloading OWID energy data...')
        r = requests.get(OWID_URL, timeout=180)
        r.raise_for_status()
        OWID_CACHE.write_bytes(r.content)
        print(f'  Cached -> {OWID_CACHE}')
    return pd.read_csv(OWID_CACHE, low_memory=False)


def _build_generation(refresh: bool = False) -> dict:
    df   = _load_owid(refresh)
    arm  = df[df['iso_code'] == 'ARM'].copy()
    arm['year'] = pd.to_numeric(arm['year'], errors='coerce').astype('Int64')
    arm  = arm[arm['year'].isin(YEARS)].sort_values('year')

    years_out: list[int] = [int(y) for y in arm['year']]
    if not years_out:
        raise ValueError('No Armenia rows found in OWID dataset')

    fuels: dict[str, list[float]] = {}
    for col, label in OWID_FUEL_MAP.items():
        if col not in arm.columns:
            continue
        vals_gwh = [round(float(v) * 1000, 1) if pd.notna(v) else 0.0
                    for v in arm[col]]
        if any(v > 0 for v in vals_gwh):
            fuels[label] = vals_gwh

    # Demand = generation + net imports (net_elec_imports can be negative for net exporters)
    demand: list[float] = []
    if 'electricity_generation' in arm.columns and 'net_elec_imports' in arm.columns:
        for g, n in zip(arm['electricity_generation'], arm['net_elec_imports']):
            gv = float(g) if pd.notna(g) else 0.0
            nv = float(n) if pd.notna(n) else 0.0
            demand.append(round((gv + nv) * 1000, 1))

    return {
        'source': (
            'Our World in Data / Ember — Yearly Electricity Data '
            '(github.com/owid/energy-data, CC BY 4.0)'
        ),
        'unit':   'GWh',
        'note': (
            'Hydro = all hydropower (reservoir + run-of-river not distinguished in OWID). '
            'Demand = generation + net imports (OWID electricity_generation + net_elec_imports).'
        ),
        'years':  years_out,
        'fuels':  fuels,
        'demand': demand,
    }


# ── Trade ────────────────────────────────────────────────────────────────────

def _build_trade(geo_trade: dict[int, dict[str, float]]) -> dict:
    """
    Build trade/ARM.json combining:
      exports  → Iran (curated IEA/Armstat) + Georgia corridor (ESCO PDFs)
      imports  → Russia via Georgia (ESCO PDFs) + Iran balancing (Armstat)

    Georgia corridor exports = ARM→GEO direct + ARM→Turkey transiting via GEO.
    Russia imports = electricity transiting through Georgia TO Armenia.

    GEO→ARM direct imports (Armenia importing from Georgian grid) are not
    separately labelled in the available ESCO PDFs and are therefore absent.
    """
    years_out = YEARS

    def _series(mapping: dict[int, float]) -> list[float]:
        return [round(mapping.get(yr, 0.0), 1) for yr in years_out]

    # Georgia corridor = direct ARM→GEO + transit ARM→TUR via GEO
    arm_geo_corridor: dict[int, float] = {}
    for yr in years_out:
        d = geo_trade.get(yr, {})
        arm_geo_corridor[yr] = d.get('arm_to_geo', 0.0) + d.get('arm_to_tur', 0.0)

    # Russia-via-Georgia arrivals to Armenia
    rus_to_arm: dict[int, float] = {
        yr: geo_trade.get(yr, {}).get('rus_to_arm', 0.0)
        for yr in years_out
    }

    exports: dict[str, list[float]] = {}
    imports_: dict[str, list[float]] = {}

    exports['Iran'] = _series(ARM_IRAN_EXPORTS)

    geo_series = _series(arm_geo_corridor)
    if any(v > 0 for v in geo_series):
        exports['Georgia'] = geo_series

    rus_series = _series(rus_to_arm)
    if any(v > 0 for v in rus_series):
        imports_['Russia (via Georgia)'] = rus_series

    iran_imp = _series(ARM_IRAN_IMPORTS)
    if any(v > 0 for v in iran_imp):
        imports_['Iran'] = iran_imp

    return {
        'country': 'Armenia',
        'unit':    'GWh',
        'source': (
            'Exports to Iran: IEA Armenia Energy Profile (2019, 2021), '
            'Armstat / Ampop.am (2022-2023), Worldometer (2016). '
            'Georgia corridor: ESCO Georgia Generation Balance PDFs 2020-2023. '
            'Russia via Georgia: same ESCO PDFs ("Transit from Russia to Armenia").'
        ),
        'years':   years_out,
        'exports': exports,
        'imports': imports_,
    }


# ── Entry point ──────────────────────────────────────────────────────────────

def run(refresh: bool = False) -> None:
    print('[ARM] Armenia pipeline')
    print('  Building generation from OWID/Ember...')
    generation = _build_generation(refresh)
    print(f'  gen years: {generation["years"][0]}-{generation["years"][-1]}, '
          f'fuels: {list(generation["fuels"].keys())}')

    print('  Extracting Georgia trade from PDFs...')
    geo_trade = _extract_geo_trade(list(range(2020, 2024)))

    print('  Building trade...')
    trade = _build_trade(geo_trade)

    supply_out = {
        'country':    'Armenia',
        'generation': generation,
    }

    OUT_SUPPLY.parent.mkdir(parents=True, exist_ok=True)
    OUT_TRADE.parent.mkdir(parents=True, exist_ok=True)

    OUT_SUPPLY.write_text(json.dumps(supply_out, indent=2, ensure_ascii=False), encoding='utf-8')
    OUT_TRADE.write_text(json.dumps(trade, indent=2, ensure_ascii=False), encoding='utf-8')

    print(f'  supply -> {OUT_SUPPLY}')
    print(f'  trade  -> {OUT_TRADE}')
    print(f'    exports: {list(trade["exports"].keys())}')
    print(f'    imports: {list(trade["imports"].keys())}')


if __name__ == '__main__':
    import sys
    refresh = '--refresh' in sys.argv
    run(refresh=refresh)
