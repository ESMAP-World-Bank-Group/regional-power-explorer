"""
Azerbaijan supply + trade pipeline.

Supply data sourced from SSC Azerbaijan (stat.gov.az — chapter 5).
Arrays below were manually extracted from:
  data-source/raw/AZE/ssc_005_4_generation.xls  — Table 5.4 generation (GWh)
  data-source/raw/AZE/ssc_005_3_capacity.xls    — Table 5.3 capacity (MW)

Trade data sourced from multi-source compilation:
  data-source/raw/AZE/aze_cross_border_flows.csv

Outputs:
  public/data/supply/AZE.json
  public/data/trade/AZE.json
"""
import json
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW  = ROOT / 'data-source' / 'raw' / 'AZE'
OUT_SUPPLY = ROOT / 'public' / 'data' / 'supply' / 'AZE.json'
OUT_TRADE  = ROOT / 'public' / 'data' / 'trade'  / 'AZE.json'


def _r(v):
    try:
        return round(float(v), 1)
    except Exception:
        return None


# ─── Supply data (manually extracted from SSC XLS) ───────────────────────────
HIST_YEARS = list(range(2015, 2025))

GEN_HIST = {
    'Gas CCGT (public)':          [20905, 20699, 20445, 21243, 22290, 22471, 24309, 25137, 25238, 22683],
    'Gas (industrial auto-prod)': [ 1955,  2062,  1900,  1934,  1873,  1955,  1962,  1957,  1946,  1881],
    'Hydro':                      [ 1638,  1959,  1746,  1768,  1565,  1070,  1277,  1596,  1763,  3008],
    'Solar':                      [    5,    35,    37,    39,    44,    47,    55,    61,    81,   556],
    'Wind':                       [    5,    23,    22,    83,   105,    96,    91,    83,    55,    51],
    'Waste/Other':                 [  182,   175,   170,   162,   196,   201,   193,   205,   223,   233],
}
DEMAND_HIST = [17619, 17618, 17085, 17812, 18666, 19019, 20386, 20259, 20158, 21392]

CAP_HIST = {
    'Gas CCGT (public)':          [3461] * 10,
    'Gas CHP+industrial (est.)':  [1200] * 10,
    'Hydro':      [1103, 1105, 1106, 1131, 1145, 1149, 1157, 1165, 1209, 1062],
    'Solar':      [   5,   25,   28,   35,   35,   35,   48,   51,  266,  258],
    'Wind':       [   8,   16,   16,   66,   66,   66,   66,   64,   64,   64],
    'Waste/Other':[  38,   38,   43,   45,   45,   45,   45,   45,   45,   33],
}
PEAK_HIST = [round(s / (8760 * 0.582) * 1000) for s in [
    24531, 23972, 23146, 23915, 24719, 24825, 26366, 26180, 26272, 27187
]]


# ─── Trade CSV ────────────────────────────────────────────────────────────────
BORDER_MAP = {
    'Georgia (Samukh-Gardabani)':    'Georgia',
    'Turkey (via Georgia transit)':  'Turkey',
    'Iran (Mugan / Astara / Julfa)': 'Iran',
    'Russia (Hajigabul-Mozdok)':     'Russia',
    'Armenia':                        'Armenia',
}
IMP_BORDERS = ['Russia', 'Iran', 'Georgia', 'Armenia']
EXP_BORDERS = ['Turkey', 'Georgia', 'Iran', 'Russia']


def _build_trade():
    flows = pd.read_csv(RAW / 'aze_cross_border_flows.csv')
    flows['border_clean'] = flows['border'].map(BORDER_MAP).fillna(flows['border'])
    years = sorted(flows['year'].unique().tolist())

    def agg(flow_type, borders):
        sub = flows[flows['type'] == flow_type]
        result = {}
        for b in borders:
            vals = []
            for yr in years:
                v = float(sub[(sub['border_clean'] == b) & (sub['year'] == yr)]['volume_GWh'].sum())
                vals.append(round(v, 1))
            result[b] = vals
        return result

    return years, agg('import', IMP_BORDERS), agg('export', EXP_BORDERS)


# ─── Build and write JSONs ────────────────────────────────────────────────────
def run():
    supply = {
        "country": "Azerbaijan",
        "generation": {
            "source": "SSC Azerbaijan · Table 5.4 — State Statistical Committee",
            "unit": "GWh",
            "note": (
                "Gas CCGT = Azerenerji public plants. "
                "Gas industrial = SOCAR self-gen (counted in SSC but not injected into public grid)."
            ),
            "years": HIST_YEARS,
            "fuels": {k: list(v) for k, v in GEN_HIST.items()},
            "demand": DEMAND_HIST,
        },
        "capacity": {
            "source": "SSC Azerbaijan · Table 5.3 — State Statistical Committee",
            "unit": "MW",
            "note": (
                "Gas CHP+industrial estimated stable ~1,200 MW. "
                "Retired Soviet-era ST units (~610–2,200 MW) excluded."
            ),
            "years": HIST_YEARS,
            "fuels": {k: list(v) for k, v in CAP_HIST.items()},
            "peak_demand": PEAK_HIST,
        },
    }

    OUT_SUPPLY.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_SUPPLY, 'w', encoding='utf-8') as f:
        json.dump(supply, f, indent=2, ensure_ascii=False)
    print(f'AZE supply → {OUT_SUPPLY}')

    years, imp, exp = _build_trade()
    trade = {
        "country": "Azerbaijan",
        "unit": "GWh",
        "source": "SSC Azerbaijan · Caliber.az · Galt & Taggart FY24/FY25 · APA.az",
        "years": years,
        "imports": imp,
        "exports": exp,
    }

    OUT_TRADE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_TRADE, 'w', encoding='utf-8') as f:
        json.dump(trade, f, indent=2, ensure_ascii=False)
    print(f'AZE trade  → {OUT_TRADE}')


if __name__ == '__main__':
    run()
