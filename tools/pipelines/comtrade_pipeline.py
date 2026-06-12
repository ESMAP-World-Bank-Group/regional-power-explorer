"""
Generic UN Comtrade electricity trade pipeline.

Generates public/data/trade/{ISO3}.json for any list of countries using
UN Comtrade+ API, HS commodity code 2716 (electrical energy).

API setup:
  1. Create a free account at https://comtradeplus.un.org
  2. Subscribe to the free tier (500 requests/month)
  3. Copy your API key and add it to config/api_tokens.ini:
       [api_tokens]
       comtrade = <your-key>

Cache:
  data-source/raw/COMTRADE/{ISO3}_{year}_X.json  (gitignored)
  data-source/raw/COMTRADE/{ISO3}_{year}_M.json  (gitignored)

Usage:
  python tools/pipelines/comtrade_pipeline.py
  python tools/pipelines/comtrade_pipeline.py --refresh
  python tools/pipelines/comtrade_pipeline.py KAZ UZB
"""
from __future__ import annotations

import json
import sys
import time
from configparser import ConfigParser
from pathlib import Path

import requests

ROOT      = Path(__file__).resolve().parents[2]
RAW       = ROOT / 'data-source' / 'raw' / 'COMTRADE'
OUT_TRADE = ROOT / 'public' / 'data' / 'trade'

BASE_URL = 'https://comtradeapi.un.org/data/v1/get/C/A/HS'

YEARS = list(range(2015, 2024))  # 2015-2023

# UN M49 numeric codes for reporter countries
M49: dict[str, str] = {
    # Central Asia
    'KAZ': '398',
    'UZB': '860',
    'KGZ': '417',
    'TJK': '762',
    'TKM': '795',
    # ASEAN
    'BRN': '096',
    'KHM': '116',
    'IDN': '360',
    'LAO': '418',
    'MYS': '458',
    'MMR': '104',
    'PHL': '608',
    'SGP': '702',
    'THA': '764',
    'VNM': '704',
}

# M49 code → ISO3 (for looking up partner names in the output)
M49_TO_ISO3: dict[str, str] = {v: k for k, v in M49.items()}

# Comtrade quantity unit codes → GWh conversion factor
# 3   = "1000 kWh" (= MWh = 0.001 GWh) — most common for HS 2716
# 74  = Thousand kWh — same as 3 in some API versions
# 8   = MWh → 0.001 GWh
# 133 = GWh → 1.0
QTY_TO_GWH: dict[int, float] = {
    3:   0.001,   # 1000 kWh → GWh
    74:  0.001,   # Thousand kWh → GWh
    8:   0.001,   # MWh → GWh
    133: 1.0,     # GWh → GWh
}

DEFAULT_COUNTRIES = list(M49.keys())


def _load_api_key() -> str | None:
    candidates = [
        ROOT / 'config' / 'api_tokens.ini',
        ROOT.parent / 'black_sea_2026' / 'EPM' / 'pre-analysis' / 'config' / 'api_tokens.ini',
    ]
    for path in candidates:
        if path.exists():
            cfg = ConfigParser()
            cfg.read(path, encoding='utf-8')
            if cfg.has_option('api_tokens', 'comtrade'):
                val = cfg.get('api_tokens', 'comtrade').strip()
                if val:
                    return val
    return None


def _cache_path(iso3: str, year: int, flow: str) -> Path:
    return RAW / f'{iso3}_{year}_{flow}.json'


def _fetch_flow(
    iso3: str,
    year: int,
    flow: str,
    api_key: str,
    refresh: bool = False,
) -> list[dict]:
    """Fetch one year × flow for a reporter, using cache."""
    cache = _cache_path(iso3, year, flow)
    if cache.exists() and not refresh:
        return json.loads(cache.read_text(encoding='utf-8'))

    params = {
        'reporterCode': M49[iso3],
        'period':       str(year),
        'cmdCode':      '2716',
        'flowCode':     flow,
        'includeDesc':  'true',
    }
    headers = {'Ocp-Apim-Subscription-Key': api_key}

    try:
        r = requests.get(BASE_URL, params=params, headers=headers, timeout=30)
        r.raise_for_status()
        rows = r.json().get('data', [])
    except Exception as exc:
        print(f'    SKIP {iso3} {year} {flow}: {exc}')
        return []

    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
    print(f'    {iso3} {year} {flow}: {len(rows)} rows')
    time.sleep(2.0)  # free tier rate limit: ~1 req/s, 2s to be safe
    return rows


MAX_BILATERAL_GWH = 200_000  # single-year per-partner cap; catches unit-entry errors in Comtrade
# 200 TWh is a safe ceiling: even France→Germany peaks ~80 TWh/year.
# The 10 TWh ceiling was fine for Central Asia but too low for ASEAN
# (Laos→Thailand reaches ~36 TWh/year). Genuine unit errors (e.g. kWh
# reported instead of MWh) would show as 1000× the real value, so the
# ceiling would need to be 200 PWh to miss them at 200 TWh scale — safe.


def _rows_to_gwh(rows: list[dict]) -> dict[str, float]:
    """
    Convert Comtrade rows to {partner_name: GWh}.

    Comtrade returns multiple rows per (partner, year, flow) due to:
    - Mode of transport breakdown: motCode=0 is TOTAL, motCode>0 are sub-modes.
      Summing both would double-count. Rule: if TOTAL rows exist for a partner,
      use only those; otherwise sum the sub-mode rows.
    - Exact duplicates: deduplicate on (motCode, qtyUnitCode, qty).

    Other filters:
    - Skip 'World' aggregate rows (partnerCode == 0)
    - Skip partner2 (via-third-country) rows: only keep partner2Code == 0
    """
    # Step 1: collect valid rows per partner
    by_partner: dict[str, list[dict]] = {}
    for row in rows:
        if row.get('partnerCode', 0) == 0:
            continue
        if row.get('partner2Code', 0) != 0:
            continue
        partner = row.get('partnerDesc', '') or row.get('partnerISO', '')
        if not partner:
            continue
        by_partner.setdefault(partner, []).append(row)

    totals: dict[str, float] = {}
    for partner, partner_rows in by_partner.items():
        # Step 2: prefer TOTAL MOT rows (motCode=0) over sub-mode breakdown rows
        total_mot = [r for r in partner_rows if r.get('motCode', 0) == 0]
        rows_to_use = total_mot if total_mot else partner_rows

        # Step 3: deduplicate on (motCode, qtyUnitCode, qty) — removes exact copies
        seen: set[tuple] = set()
        gwh_sum = 0.0
        for row in rows_to_use:
            unit_code = row.get('qtyUnitCode')
            qty = row.get('qty')
            if qty is None or unit_code not in QTY_TO_GWH:
                continue
            key = (row.get('motCode', 0), unit_code, qty)
            if key in seen:
                continue
            seen.add(key)
            gwh = round(float(qty) * QTY_TO_GWH[unit_code], 1)
            if gwh <= 0:
                continue
            gwh_sum += gwh

        if gwh_sum <= 0:
            continue
        if gwh_sum > MAX_BILATERAL_GWH:
            print(f'    WARNING: outlier {partner} {gwh_sum:.0f} GWh — skipping (likely unit error)')
            continue
        totals[partner] = totals.get(partner, 0.0) + gwh_sum
    return totals


def _build_trade(iso3: str, api_key: str, refresh: bool) -> dict | None:
    """Build trade JSON for one country over all years."""
    # {partner: [gwh_per_year]}
    exports_by_partner: dict[str, list[float]] = {}
    imports_by_partner: dict[str, list[float]] = {}

    for yr in YEARS:
        exp_rows = _fetch_flow(iso3, yr, 'X', api_key, refresh)
        imp_rows = _fetch_flow(iso3, yr, 'M', api_key, refresh)

        exp_gwh = _rows_to_gwh(exp_rows)
        imp_gwh = _rows_to_gwh(imp_rows)

        # Collect all partners seen so far
        for partner in exp_gwh:
            exports_by_partner.setdefault(partner, [0.0] * len(YEARS))
        for partner in imp_gwh:
            imports_by_partner.setdefault(partner, [0.0] * len(YEARS))

        yr_idx = YEARS.index(yr)
        for partner, gwh in exp_gwh.items():
            exports_by_partner[partner][yr_idx] = gwh
        for partner, gwh in imp_gwh.items():
            imports_by_partner[partner][yr_idx] = gwh

    if not exports_by_partner and not imports_by_partner:
        print(f'  [{iso3}] no trade data found')
        return None

    # Filter noise: keep only partners with ≥100 GWh total across all years,
    # and exclude Comtrade catch-all groupings that are not real countries.
    # Rationale: small totals (<100 GWh over 9 years) are re-export/transit
    # artefacts with no physical connection (e.g. UZB→Singapore 96 GWh,
    # UZB→China 31 GWh). "Areas, nes" is a UN aggregate code, not a country.
    MIN_PARTNER_TOTAL_GWH = 100.0
    _NOT_COUNTRIES = {'areas, nes', 'other asia, nes', 'other europe, nes'}
    exports = {
        p: v for p, v in exports_by_partner.items()
        if sum(v) >= MIN_PARTNER_TOTAL_GWH and p.lower() not in _NOT_COUNTRIES
    }
    imports = {
        p: v for p, v in imports_by_partner.items()
        if sum(v) >= MIN_PARTNER_TOTAL_GWH and p.lower() not in _NOT_COUNTRIES
    }

    total_exp = sum(sum(v) for v in exports.values())
    total_imp = sum(sum(v) for v in imports.values())
    print(f'  [{iso3}] exports to {len(exports)} partners ({total_exp:.0f} GWh total)  '
          f'imports from {len(imports)} partners ({total_imp:.0f} GWh total)')

    return {
        'country': iso3,
        'unit':    'GWh',
        'source':  'UN Comtrade+ — HS 2716 Electrical Energy (comtradeplus.un.org)',
        'years':   YEARS,
        'exports': exports,
        'imports': imports,
    }


def run(
    countries: list[str] | None = None,
    refresh: bool = False,
) -> None:
    """
    Generate trade JSONs for given countries.

    Args:
        countries: list of ISO3 codes — defaults to all CA countries
        refresh:   force re-fetch (bypasses cache)
    """
    if countries is None:
        countries = DEFAULT_COUNTRIES

    api_key = _load_api_key()
    if not api_key:
        print('  [comtrade] No API key found.')
        print('    Add [api_tokens] comtrade = <key> to config/api_tokens.ini')
        print('    (Free key: https://comtradeplus.un.org)')
        return

    OUT_TRADE.mkdir(parents=True, exist_ok=True)

    for iso3 in countries:
        if iso3 not in M49:
            print(f'  [{iso3}] no M49 code configured — skipping')
            continue
        print(f'  [{iso3}] fetching Comtrade HS 2716...')
        trade = _build_trade(iso3, api_key, refresh)
        if trade is None:
            continue
        out_path = OUT_TRADE / f'{iso3}.json'
        out_path.write_text(
            json.dumps(trade, indent=2, ensure_ascii=False), encoding='utf-8'
        )
        print(f'  trade  -> {out_path}')


if __name__ == '__main__':
    args = sys.argv[1:]
    refresh = '--refresh' in args
    iso3_filter = [a for a in args if not a.startswith('--')]

    countries = iso3_filter if iso3_filter else DEFAULT_COUNTRIES
    print('=== Comtrade pipeline ===')
    run(countries=countries, refresh=refresh)
    print()
    print('Done.')
