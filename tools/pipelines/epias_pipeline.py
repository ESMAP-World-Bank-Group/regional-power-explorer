"""
Turkiye electricity market prices — EPIAS Transparency Platform pipeline.
https://seffaflik.epias.com.tr

Generates public/data/market/TUR.json with three hourly price series:
  - dam: Day-Ahead Market — Market Clearing Price (MCP)
  - idm: Intraday Market — Weighted Average Price (WAP)
  - bpm: Balancing Power Market — System Marginal Price (SMP)

Good to know:
  - Auth is handled by the eptr2 client (logs in with username/password,
    manages the EPIAS session token internally).
  - Each run only fetches a short recent window and merges it into the
    existing file — older history is never overwritten.
  - Only the last 90 days of hourly detail are kept; older dates live on
    as daily/monthly/yearly averages only, to keep the file small.
  - To add another price series later, add one line to SERIES below.

Credentials: env vars EPIAS_USERNAME / EPIAS_PASSWORD, or
  [api_tokens] epias_username / epias_password in config/api_tokens.ini

Usage:
  python tools/pipelines/epias_pipeline.py                          # last 14 days
  python tools/pipelines/epias_pipeline.py --start-date 2018-01-01  # one-time backfill
  
"""
from __future__ import annotations

import json
import os
import time
import warnings
from calendar import monthrange
from configparser import ConfigParser
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

warnings.filterwarnings('ignore')

ROOT       = Path(__file__).resolve().parents[2]
OUT_MARKET = ROOT / 'public' / 'data' / 'market' / 'TUR.json'
UNIT       = 'TL/MWh'

# A normal run only needs to look back this far — enough to catch late
# corrections plus fill in "today". Pass --start-date for a one-off backfill.
DEFAULT_FETCH_WINDOW_DAYS = 14

# How much raw hourly detail to keep in the output file (older hours are
# still represented in the daily/monthly/yearly aggregates, just not hour
# by hour — this keeps the JSON file small even after years of daily runs).
HOURLY_RETENTION_DAYS = 90

# ─── Series registry — add a new price series by adding one entry here ──────
#   endpoint    : eptr2 call name (see eptr2 docs / seffaflik technical guide)
#   label       : human-readable name, shown in the output json and the UI
#   value_field : column in the eptr2 response holding the price number
SERIES = {
    'dam': {'endpoint': 'mcp', 'label': 'Day-Ahead Market — Market Clearing Price',        'value_field': 'price'},
    'idm': {'endpoint': 'wap', 'label': 'Intraday Market — Weighted Average Price',        'value_field': 'wap'},
    'bpm': {'endpoint': 'smp', 'label': 'Balancing Power Market — System Marginal Price',  'value_field': 'systemMarginalPrice'},
}


# ═══════════════════════════════════════════════════════════════════════════
# Credentials
# ═══════════════════════════════════════════════════════════════════════════

def _load_credentials() -> tuple[str, str]:
    env_user = os.getenv('EPIAS_USERNAME')
    env_pass = os.getenv('EPIAS_PASSWORD')
    if env_user and env_pass:
        return env_user, env_pass

    candidates = [
        ROOT / 'config' / 'api_tokens.ini',
        ROOT.parent / 'black_sea_2026' / 'EPM' / 'pre-analysis' / 'config' / 'api_tokens.ini',
    ]
    for path in candidates:
        if not path.exists():
            continue
        cfg = ConfigParser()
        cfg.read(path)
        user = cfg.get('api_tokens', 'epias_username', fallback=None)
        pwd  = cfg.get('api_tokens', 'epias_password', fallback=None)
        if user and pwd:
            return user, pwd

    raise RuntimeError(
        'EPIAS credentials not found. Set env vars EPIAS_USERNAME / EPIAS_PASSWORD, '
        'or add to config/api_tokens.ini:\n'
        '  [api_tokens]\n  epias_username = ...\n  epias_password = ...'
    )


# ═══════════════════════════════════════════════════════════════════════════
# Fetch — one series, in monthly chunks, from the EPIAS API
# ═══════════════════════════════════════════════════════════════════════════

def _timestamp_column(df: pd.DataFrame) -> str:
    return next((c for c in df.columns if 'date' in c.lower() or 'time' in c.lower()), df.columns[0])


def _fetch_series(client, endpoint: str, value_field: str, start: date, end: date) -> pd.Series:
    """Returns one hourly pd.Series (UTC-indexed) for a single eptr2 endpoint,
    fetched month by month so we never ask the API for too much at once."""
    frames = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        last_day    = monthrange(year, month)[1]
        chunk_start = f'{year}-{month:02d}-01'
        chunk_end   = f'{year}-{month:02d}-{min(last_day, end.day) if (year, month) == (end.year, end.month) else last_day:02d}'
        label       = f'{year}-{month:02d}'
        try:
            df = client.call(endpoint, start_date=chunk_start, end_date=chunk_end)
        except Exception as exc:
            print(f'  [epias] {endpoint} {label}: FAILED — {exc}')
            df = None

        if df is not None and not df.empty:
            if value_field not in df.columns:
                print(f'  [epias] {endpoint} {label}: WARNING — expected column "{value_field}" not found. '
                      f'Available columns: {list(df.columns)}. Fix SERIES["{endpoint}"]["value_field"] and re-run.')
            else:
                ts_col = _timestamp_column(df)
                s = pd.Series(df[value_field].values, index=pd.to_datetime(df[ts_col], utc=True))
                frames.append(s)
                print(f'  [epias] {endpoint} {label}: {len(s)} rows')
        else:
            print(f'  [epias] {endpoint} {label}: no data')

        month += 1
        if month > 12:
            month, year = 1, year + 1
        time.sleep(0.5)  # be polite to the API

    if not frames:
        return pd.Series(dtype=float)
    combined = pd.concat(frames).sort_index()
    return combined[~combined.index.duplicated(keep='first')]


# ═══════════════════════════════════════════════════════════════════════════
# Aggregate — hourly → daily / monthly / yearly, each as {mean, min, max}
# ═══════════════════════════════════════════════════════════════════════════

def _stats_by(hourly: pd.Series, group_keys) -> dict:
    """{'mean': {date_str: value}, 'min': {...}, 'max': {...}} for one grouping."""
    grouped = hourly.groupby(group_keys)
    return {
        'mean': {str(k): round(v, 2) for k, v in grouped.mean().items()},
        'min':  {str(k): round(v, 2) for k, v in grouped.min().items()},
        'max':  {str(k): round(v, 2) for k, v in grouped.max().items()},
    }


def _aggregate(hourly: pd.Series) -> dict:
    return {
        'daily':   _stats_by(hourly, hourly.index.date),
        'monthly': _stats_by(hourly, hourly.index.to_period('M')),
        'yearly':  _stats_by(hourly, hourly.index.year),
    }


def _merge_stats(old: dict | None, new: dict) -> dict:
    """Combine two {'mean': {}, 'min': {}, 'max': {}} blocks — new values win
    on any overlapping date, everything else from `old` is kept as-is."""
    old = old or {}
    return {stat: {**old.get(stat, {}), **new.get(stat, {})} for stat in ('mean', 'min', 'max')}


def _recent_hourly(hourly: pd.Series, old_hourly: dict) -> dict:
    """Raw hourly values for the last HOURLY_RETENTION_DAYS only. Falls back
    to whatever was already saved if this run fetched nothing new enough."""
    cutoff = pd.Timestamp.now(tz='UTC') - pd.Timedelta(days=HOURLY_RETENTION_DAYS)
    recent = hourly[hourly.index >= cutoff] if len(hourly) else hourly
    if recent.empty:
        return old_hourly
    return {t.isoformat(): round(v, 2) for t, v in recent.items()}


def _build_series_block(old_block: dict, label: str, hourly: pd.Series) -> dict:
    agg = _aggregate(hourly) if len(hourly) else {'daily': {}, 'monthly': {}, 'yearly': {}}
    return {
        'label':   label,
        'hourly':  _recent_hourly(hourly, old_block.get('hourly', {})),
        'daily':   _merge_stats(old_block.get('daily'),   agg['daily']),
        'monthly': _merge_stats(old_block.get('monthly'), agg['monthly']),
        'yearly':  _merge_stats(old_block.get('yearly'),  agg['yearly']),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Main entry point
# ═══════════════════════════════════════════════════════════════════════════

def run(start_date: str | None = None, end_date: str | None = None) -> None:
    from eptr2 import EPTR2  # imported lazily so the rest of the pipeline can be
                              # imported/tested without eptr2 installed

    end   = date.fromisoformat(end_date) if end_date else date.today()
    start = date.fromisoformat(start_date) if start_date else end - timedelta(days=DEFAULT_FETCH_WINDOW_DAYS)

    username, password = _load_credentials()
    client = EPTR2(username=username, password=password, ssl_verify=False)
    print(f'[epias] Authenticated as {username}')
    print(f'[epias] Fetching {start} → {end}')

    existing: dict = {}
    if OUT_MARKET.exists():
        existing = json.loads(OUT_MARKET.read_text(encoding='utf-8'))

    market = {
        'country': 'Turkiye',
        'unit':    UNIT,
        'source':  'EPIAS Transparency Platform (seffaflik.epias.com.tr)',
        'updated': date.today().isoformat(),
    }
    for key, cfg in SERIES.items():
        print(f'[epias] {cfg["label"]} ({key}) ...')
        hourly = _fetch_series(client, cfg['endpoint'], cfg['value_field'], start, end)
        if hourly.empty:
            print(f'  [epias] WARNING: no new data for {key} this run — kept previous values')
        market[key] = _build_series_block(existing.get(key, {}), cfg['label'], hourly)

    OUT_MARKET.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_MARKET, 'w', encoding='utf-8') as f:
        json.dump(market, f, indent=2, ensure_ascii=False, allow_nan=False)
    print(f'TUR market → {OUT_MARKET}')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Fetch Turkiye market prices from EPIAS')
    parser.add_argument('--start-date', type=str, default=None,
                         help='YYYY-MM-DD. Default: 14 days ago. Use e.g. 2018-01-01 once, to backfill full history.')
    parser.add_argument('--end-date', type=str, default=None,
                         help='YYYY-MM-DD. Default: today.')
    args = parser.parse_args()
    run(start_date=args.start_date, end_date=args.end_date)
