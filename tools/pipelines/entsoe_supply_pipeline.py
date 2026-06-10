"""
ENTSO-E supply pipeline.

Generates public/data/supply/{ISO3}.json for all ENTSO-E member countries.

Data sources:
  Generation (GWh): A75 — Actual Generation per Production Type
                    Queried year-by-year, resampled from hourly/15-min to annual.
  Capacity   (MW):  A68 — Installed Generation Capacity Aggregated
                    Annual snapshot, single query per country.
  Demand     (GWh): A65 — Actual Total Load, resampled to annual.

Token: env var API_TOKEN_ENTSOE, or [api_tokens] entsoe key in:
  1. {repo}/config/api_tokens.ini
  2. sibling EPM project: black_sea_2026/EPM/config/api_tokens.ini

Raw cache: data-source/raw/ENTSOE/*.csv  (gitignored — regenerated from API)

Usage:
  # All countries (slow first run ~30-60 min, instant thereafter):
  python tools/pipelines/entsoe_supply_pipeline.py

  # Specific countries (ISO2 codes):
  python tools/pipelines/entsoe_supply_pipeline.py BG RO GR

  # Force re-download even if cache exists:
  python tools/pipelines/entsoe_supply_pipeline.py --refresh BG RO
"""
import json
import os
import sys
import time
from configparser import ConfigParser
from pathlib import Path

import pandas as pd
from entsoe import EntsoePandasClient

ROOT = Path(__file__).resolve().parents[2]
RAW  = ROOT / 'data-source' / 'raw' / 'ENTSOE'
OUT  = ROOT / 'public' / 'data' / 'supply'

YEARS = list(range(2015, 2025))
TZ    = 'Europe/Brussels'

# ── Country list: ISO2 -> (ISO3, display name) ────────────────────────────────
COUNTRIES = {
    'AL': ('ALB', 'Albania'),
    'AT': ('AUT', 'Austria'),
    'BA': ('BIH', 'Bosnia and Herzegovina'),
    'BE': ('BEL', 'Belgium'),
    'BG': ('BGR', 'Bulgaria'),
    'CH': ('CHE', 'Switzerland'),
    'CY': ('CYP', 'Cyprus'),
    'CZ': ('CZE', 'Czech Republic'),
    'DE': ('DEU', 'Germany'),
    'DK': ('DNK', 'Denmark'),
    'EE': ('EST', 'Estonia'),
    'ES': ('ESP', 'Spain'),
    'FI': ('FIN', 'Finland'),
    'FR': ('FRA', 'France'),
    'GB': ('GBR', 'United Kingdom'),
    'GR': ('GRC', 'Greece'),
    'HR': ('HRV', 'Croatia'),
    'HU': ('HUN', 'Hungary'),
    'IE': ('IRL', 'Ireland'),
    'IT': ('ITA', 'Italy'),
    'LT': ('LTU', 'Lithuania'),
    'LU': ('LUX', 'Luxembourg'),
    'LV': ('LVA', 'Latvia'),
    'ME': ('MNE', 'Montenegro'),
    'MK': ('MKD', 'North Macedonia'),
    'MT': ('MLT', 'Malta'),
    'NL': ('NLD', 'Netherlands'),
    'NO': ('NOR', 'Norway'),
    'PL': ('POL', 'Poland'),
    'PT': ('PRT', 'Portugal'),
    'RO': ('ROU', 'Romania'),
    'RS': ('SRB', 'Serbia'),
    'SE': ('SWE', 'Sweden'),
    'SI': ('SVN', 'Slovenia'),
    'SK': ('SVK', 'Slovakia'),
    'UA': ('UKR', 'Ukraine'),
}

# Some bidding-zone overrides for entsoe-py (ISO2 alone may fail)
AREA_OVERRIDES = {
    'DE': 'DE_LU',   # Germany+Luxembourg unified bidding zone since 2019
    'IT': 'IT_NORD', # Use northern Italy as proxy (aggregated IT not exposed by entsoe-py)
    'DK': 'DK_1',    # Use western Denmark (DK_1+DK_2 not aggregated via ISO2)
    'NO': 'NO_1',    # Norway has 5 bidding zones; NO_1 is largest
    'SE': 'SE_3',    # Sweden has 4 zones; SE_3 (Stockholm) is representative
}

# ── ENTSO-E production type → our fuel category ──────────────────────────────
FUEL_MAP = {
    'Fossil Gas':                      'Gas',
    'Fossil Coal-derived gas':         'Gas',
    'Fossil Hard coal':                'Coal',
    'Fossil Brown coal/Lignite':       'Lignite',
    'Fossil Oil':                      'Oil',
    'Fossil Oil shale':                'Oil',
    'Fossil Peat':                     'Other',
    'Hydro Run-of-river and poundage': 'Hydro RoR',
    'Hydro Water Reservoir':           'Hydro Reservoir',
    'Hydro Pumped Storage':            'Hydro Pumped Storage',
    'Nuclear':                         'Nuclear',
    'Solar':                           'Solar',
    'Wind Onshore':                    'Wind',
    'Wind Offshore':                   'Wind Offshore',
    'Biomass':                         'Biomass',
    'Waste':                           'Waste',
    'Geothermal':                      'Geothermal',
    'Marine':                          'Other',
    'Other':                           'Other',
    'Other renewable':                 'Other',
}


# ── Token ─────────────────────────────────────────────────────────────────────

def _load_token():
    token = os.getenv('API_TOKEN_ENTSOE')
    if token:
        return token
    candidates = [
        ROOT / 'config' / 'api_tokens.ini',
        ROOT.parent / 'black_sea_2026' / 'EPM' / 'pre-analysis' / 'config' / 'api_tokens.ini',
    ]
    for path in candidates:
        if path.exists():
            cfg = ConfigParser()
            cfg.read(path)
            if cfg.has_option('api_tokens', 'entsoe'):
                val = cfg.get('api_tokens', 'entsoe').strip()
                if val:
                    return val
    raise RuntimeError(
        'ENTSO-E token not found. Set env var API_TOKEN_ENTSOE '
        'or add [api_tokens] entsoe=<token> to config/api_tokens.ini'
    )


# ── DataFrame helpers ─────────────────────────────────────────────────────────

def _select_actual_aggregated(df):
    """For MultiIndex columns (Actual Aggregated / Actual Consumption), keep only generation."""
    if df is None:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        mask = df.columns.get_level_values(0) == 'Actual Aggregated'
        df = df.loc[:, mask].copy()
        df.columns = df.columns.get_level_values(1)
    return df


def _agg_to_categories(raw_dict):
    """Sum raw ENTSO-E fuel values into our simplified categories. Drops zeros."""
    out = {}
    for entsoe_type, value in raw_dict.items():
        cat = FUEL_MAP.get(str(entsoe_type).strip())
        if cat is None or value <= 0:
            continue
        out[cat] = round(out.get(cat, 0.0) + float(value), 1)
    return out


# ── Generation (GWh) ──────────────────────────────────────────────────────────

def _cache_gen(iso2, year):
    return RAW / f'gen_{iso2}_{year}.csv'


def _fetch_gen_year(client, iso2, year, refresh):
    cache = _cache_gen(iso2, year)
    if cache.exists() and not refresh:
        df = pd.read_csv(cache, index_col=0, parse_dates=True)
        return _select_actual_aggregated(df)

    start = pd.Timestamp(f'{year}-01-01', tz=TZ)
    end   = pd.Timestamp(f'{year+1}-01-01', tz=TZ)
    code  = AREA_OVERRIDES.get(iso2, iso2)
    df = client.query_generation(code, start=start, end=end)
    df = _select_actual_aggregated(df)
    RAW.mkdir(parents=True, exist_ok=True)
    df.to_csv(cache)
    return df


def _to_gwh(df):
    """Convert a MW DataFrame (mixed resolution) to annual GWh totals per column.

    Uses per-row forward-difference intervals so DST transitions and resolution
    changes (e.g. 15-min vs 1-h within a year) are handled correctly.
    """
    idx = df.index.to_series()
    # Forward interval: how long does row[i] represent? (index[i+1] - index[i])
    intervals_h = idx.diff().shift(-1).dt.total_seconds().div(3600)
    # Last row gets the most common interval (mode)
    mode_h = intervals_h.dropna().mode().iloc[0]
    intervals_h = intervals_h.fillna(mode_h)
    mwh = df.clip(lower=0).multiply(intervals_h, axis=0)
    return mwh.sum() / 1000


def _annual_gen_gwh(client, iso2, year, refresh):
    df = _fetch_gen_year(client, iso2, year, refresh)
    if df is None or df.empty or len(df) < 2:
        return {}
    gwh = _to_gwh(df)
    return gwh[gwh > 0].to_dict()


# ── Capacity (MW) ─────────────────────────────────────────────────────────────

def _cache_cap(iso2):
    return RAW / f'cap_{iso2}.csv'


def _fetch_capacity(client, iso2, refresh):
    cache = _cache_cap(iso2)
    if cache.exists() and not refresh:
        return pd.read_csv(cache, index_col=0, parse_dates=True)

    start = pd.Timestamp('2015-01-01', tz=TZ)
    end   = pd.Timestamp('2025-01-01', tz=TZ)
    code  = AREA_OVERRIDES.get(iso2, iso2)
    df = client.query_installed_generation_capacity(code, start=start, end=end)
    if not isinstance(df, pd.DataFrame):
        df = pd.DataFrame(df)
    RAW.mkdir(parents=True, exist_ok=True)
    df.to_csv(cache)
    return df


def _annual_cap_mw(client, iso2, refresh):
    """Return {year: {production_type: MW}} for all available years."""
    df = _fetch_capacity(client, iso2, refresh)
    if df is None or df.empty:
        return {}
    df.index = pd.DatetimeIndex(df.index)
    result = {}
    df_year = df.copy()
    df_year['_yr'] = df_year.index.year
    for year, group in df_year.groupby('_yr'):
        row = group.drop(columns=['_yr']).iloc[-1]  # last snapshot per year
        vals = row.dropna()
        vals = vals[vals > 0]
        if not vals.empty:
            result[int(year)] = vals.to_dict()
    return result


# ── Demand (GWh) ──────────────────────────────────────────────────────────────

def _cache_load(iso2, year):
    return RAW / f'load_{iso2}_{year}.csv'


def _fetch_load_year(client, iso2, year, refresh):
    cache = _cache_load(iso2, year)
    if cache.exists() and not refresh:
        return pd.read_csv(cache, index_col=0, parse_dates=True)

    start = pd.Timestamp(f'{year}-01-01', tz=TZ)
    end   = pd.Timestamp(f'{year+1}-01-01', tz=TZ)
    code  = AREA_OVERRIDES.get(iso2, iso2)
    df = client.query_load(code, start=start, end=end)
    if isinstance(df, pd.Series):
        df = df.to_frame('Actual Load')
    RAW.mkdir(parents=True, exist_ok=True)
    df.to_csv(cache)
    return df


def _annual_demand_gwh(client, iso2, year, refresh):
    df = _fetch_load_year(client, iso2, year, refresh)
    if df is None or df.empty or len(df) < 2:
        return None
    gwh = _to_gwh(df.iloc[:, [0]])
    return round(float(gwh.iloc[0]), 1)


# ── Build one country ─────────────────────────────────────────────────────────

def _build_country(client, iso2, iso3, name, refresh):
    print(f'\n[{iso2}] {name}')

    # ── Generation ──
    gen_by_year = {}
    for year in YEARS:
        try:
            raw = _annual_gen_gwh(client, iso2, year, refresh)
            if raw:
                gen_by_year[year] = _agg_to_categories(raw)
                total = sum(gen_by_year[year].values())
                print(f'  gen {year}: {total:,.0f} GWh')
        except Exception as exc:
            print(f'  gen {year}: SKIP ({exc})')
        time.sleep(0.4)

    # ── Demand ──
    demand_by_year = {}
    for year in YEARS:
        try:
            val = _annual_demand_gwh(client, iso2, year, refresh)
            if val is not None:
                demand_by_year[year] = val
        except Exception as exc:
            print(f'  load {year}: SKIP ({exc})')
        time.sleep(0.4)

    # ── Capacity ──
    cap_by_year = {}
    try:
        raw_cap = _annual_cap_mw(client, iso2, refresh)
        for year, row in raw_cap.items():
            agg = _agg_to_categories(row)
            if agg:
                cap_by_year[year] = agg
        print(f'  cap: {len(cap_by_year)} years')
    except Exception as exc:
        print(f'  cap: SKIP ({exc})')
    time.sleep(0.4)

    gen_years = sorted(gen_by_year)
    cap_years = sorted(cap_by_year)

    if not gen_years and not cap_years:
        print(f'  -> no data, skipping JSON write')
        return

    # Collect all fuel categories (stable ordering: largest total first)
    def _ordered_fuels(by_year):
        totals = {}
        for d in by_year.values():
            for f, v in d.items():
                totals[f] = totals.get(f, 0) + v
        return sorted(totals, key=lambda f: -totals[f])

    gen_fuels = _ordered_fuels(gen_by_year)
    cap_fuels = _ordered_fuels(cap_by_year)

    supply = {'country': name}

    if gen_years:
        supply['generation'] = {
            'source': 'ENTSO-E Transparency Platform — Actual Generation per Production Type (A75)',
            'unit': 'GWh',
            'years': gen_years,
            'fuels': {
                f: [round(gen_by_year[y].get(f, 0), 1) for y in gen_years]
                for f in gen_fuels
            },
            'demand': [demand_by_year.get(y) for y in gen_years],
        }

    if cap_years:
        supply['capacity'] = {
            'source': 'ENTSO-E Transparency Platform — Installed Generation Capacity Aggregated (A68)',
            'unit': 'MW',
            'years': cap_years,
            'fuels': {
                f: [round(cap_by_year[y].get(f, 0), 1) for y in cap_years]
                for f in cap_fuels
            },
        }

    OUT.mkdir(parents=True, exist_ok=True)
    out_path = OUT / f'{iso3}.json'
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(supply, fh, indent=2, ensure_ascii=False)
    print(f'  -> {out_path}')


# ── Entry point ───────────────────────────────────────────────────────────────

def run(iso2_filter=None, refresh=False):
    """Generate supply JSONs for ENTSO-E countries.

    Args:
        iso2_filter: list of ISO2 codes to process (None = all)
        refresh:     re-download even if cache exists
    """
    RAW.mkdir(parents=True, exist_ok=True)
    token  = _load_token()
    client = EntsoePandasClient(api_key=token)

    targets = {
        k: v for k, v in COUNTRIES.items()
        if iso2_filter is None or k.upper() in {c.upper() for c in iso2_filter}
    }
    print(f'Processing {len(targets)} countries  (refresh={refresh})')

    for iso2, (iso3, name) in targets.items():
        try:
            _build_country(client, iso2, iso3, name, refresh)
        except Exception as exc:
            print(f'[{iso2}] FAILED: {exc}')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    refresh = '--refresh' in sys.argv
    run(iso2_filter=args or None, refresh=refresh)
