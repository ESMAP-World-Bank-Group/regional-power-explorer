"""
Turkiye supply + trade pipeline.

Reads from:
  data-source/raw/TUR/teias_63_generation.xls    — generation by tech (GWh) 2000-2024
  data-source/raw/TUR/teias_9_capacity.xls       — capacity by tech (MW) 2006-2024
  data-source/raw/TUR/teias_26_demand.xls        — gross demand + peak 1980-2024
  data-source/raw/TUR/tur_cross_border_flows.csv — annual cross-border flows

Outputs:
  public/data/supply/TUR.json
  public/data/trade/TUR.json
"""
import json
import warnings
import pandas as pd
from pathlib import Path

warnings.filterwarnings('ignore')

ROOT = Path(__file__).resolve().parents[2]
RAW  = ROOT / 'data-source' / 'raw' / 'TUR'
OUT_SUPPLY = ROOT / 'public' / 'data' / 'supply' / 'TUR.json'
OUT_TRADE  = ROOT / 'public' / 'data' / 'trade'  / 'TUR.json'


def _n(v):
    try:
        return float(str(v).strip())
    except Exception:
        return 0.0


def _r(v):
    try:
        f = float(v)
        return round(f, 1)
    except Exception:
        return None


# ─── Generation 2000-2024 (file 63) ──────────────────────────────────────────
# col 1=YEARS, 5=TotalCoal, 11=NaturalGas, 14=Hydro,
# 15=Geothermal+Wind, 16=Solar, 12=Renew+Waste, 10=TotalLiquid
def _build_generation():
    raw = pd.ExcelFile(RAW / 'teias_63_generation.xls').parse(0, header=None)
    rows = raw[raw[1].apply(lambda x: str(x).strip().isdigit())].copy()
    rows.columns = range(len(rows.columns))
    records = []
    for _, row in rows.iterrows():
        year = int(_n(row[1]))
        if not (2000 <= year <= 2024):
            continue
        records.append({
            'year':            year,
            'Coal':            _n(row[5]),
            'Gas':             _n(row[11]),
            'Hydro':           _n(row[14]),
            'Geothermal+Wind': _n(row[15]),
            'Solar':           _n(row[16]) or None,
            'Other':           _n(row[12]) + _n(row[10]),
        })
    return pd.DataFrame(records).sort_values('year').reset_index(drop=True)


# ─── Capacity 2006-2024 (file 9) ─────────────────────────────────────────────
# col 2=YEARS, 3=HardCoal, 4=Lignite, 5=LiquidFuels, 6=NaturalGas,
# 7=Renew+Waste, 9=Solid+Liquid multi, 10=Liquid+NatGas multi,
# 13=Hydro, 14=Geothermal, 15=Wind, 16=Solar
def _build_capacity():
    raw = pd.ExcelFile(RAW / 'teias_9_capacity.xls').parse(0, header=None)
    rows = raw[raw[2].apply(lambda x: str(x).strip().isdigit())].copy()
    rows.columns = range(len(rows.columns))
    records = []
    for _, row in rows.iterrows():
        year = int(_n(row[2]))
        if not (2006 <= year <= 2024):
            continue
        wind = _n(row[15]) or None
        solar = _n(row[16]) or None
        records.append({
            'year':         year,
            'Coal':         _n(row[3]) + _n(row[4]),
            'Gas':          _n(row[6]) + _n(row[10]),
            'OtherThermal': _n(row[5]) + _n(row[7]) + _n(row[9]),
            'Hydro':        _n(row[13]),
            'Geothermal':   _n(row[14]) or None,
            'Wind':         wind,
            'Solar':        solar,
        })
    return pd.DataFrame(records).sort_values('year').reset_index(drop=True)


# ─── Demand + peak 1980-2024 (file 26) ───────────────────────────────────────
# col 1=YEARS, 3=PeakInstant(MW), 5=GrossDemand(GWh)
def _build_demand():
    raw = pd.ExcelFile(RAW / 'teias_26_demand.xls').parse(0, header=None)
    rows = raw[raw[1].apply(lambda x: str(x).strip().isdigit())].copy()
    rows.columns = range(len(rows.columns))
    records = []
    for _, row in rows.iterrows():
        year = int(_n(row[1]))
        if not (1980 <= year <= 2024):
            continue
        records.append({
            'year':            year,
            'peak_instant_mw': _n(row[3]),
            'gross_demand_gwh': _n(row[5]),
        })
    return pd.DataFrame(records).sort_values('year').set_index('year')


# ─── Trade CSV ────────────────────────────────────────────────────────────────
BORDER_MAP = {
    'Turkmenistan-(Iran)': 'Turkmenistan',
    'USSR':                'Russia/USSR',
    'Former-USSR':         'Russia/USSR',
}
IMP_BORDERS = ['Bulgaria', 'Georgia', 'Turkmenistan', 'Greece', 'Azerbaijan', 'Russia/USSR', 'Syria']
EXP_BORDERS = ['Greece', 'Iraq', 'Syria', 'Bulgaria', 'Georgia', 'Azerbaijan']


def _build_trade():
    flows = pd.read_csv(RAW / 'tur_cross_border_flows.csv')
    flows['border_clean'] = flows['border'].map(BORDER_MAP).fillna(flows['border'])
    flows = flows[flows['year'] >= 1990]
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
    gen_df = _build_generation()
    cap_df = _build_capacity()
    dem_df = _build_demand()

    gen_years = gen_df['year'].tolist()
    cap_years = cap_df['year'].tolist()

    supply = {
        "country": "Turkiye",
        "generation": {
            "source": "TEİAŞ official statistics · file 63 (generation) + file 26 (demand)",
            "unit": "GWh",
            "note": "Wind+Geothermal combined — TEİAŞ file 63 does not separate them.",
            "years": gen_years,
            "fuels": {
                "Coal":            [_r(v) for v in gen_df['Coal']],
                "Gas":             [_r(v) for v in gen_df['Gas']],
                "Hydro":           [_r(v) for v in gen_df['Hydro']],
                "Wind+Geothermal": [_r(v) for v in gen_df['Geothermal+Wind']],
                "Solar":           [_r(v) for v in gen_df['Solar']],
                "Other":           [_r(v) for v in gen_df['Other']],
            },
            "demand": [
                _r(dem_df.loc[y, 'gross_demand_gwh']) if y in dem_df.index else None
                for y in gen_years
            ],
        },
        "capacity": {
            "source": "TEİAŞ official statistics · file 9 (capacity) + file 26 (peak demand)",
            "unit": "MW",
            "note": "Geothermal and Wind are separate in file 9 (unlike generation file 63).",
            "years": cap_years,
            "fuels": {
                "Coal":         [_r(v) for v in cap_df['Coal']],
                "Gas":          [_r(v) for v in cap_df['Gas']],
                "OtherThermal": [_r(v) for v in cap_df['OtherThermal']],
                "Hydro":        [_r(v) for v in cap_df['Hydro']],
                "Geothermal":   [_r(v) for v in cap_df['Geothermal']],
                "Wind":         [_r(v) for v in cap_df['Wind']],
                "Solar":        [_r(v) for v in cap_df['Solar']],
            },
            "peak_demand": [
                _r(dem_df.loc[y, 'peak_instant_mw']) if y in dem_df.index else None
                for y in cap_years
            ],
        },
    }

    OUT_SUPPLY.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_SUPPLY, 'w', encoding='utf-8') as f:
        json.dump(supply, f, indent=2, ensure_ascii=False)
    print(f'TUR supply → {OUT_SUPPLY}')

    years, imp, exp = _build_trade()
    trade = {
        "country": "Turkiye",
        "unit": "GWh",
        "source": "TEİAŞ official statistics",
        "years": years,
        "imports": imp,
        "exports": exp,
    }

    OUT_TRADE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_TRADE, 'w', encoding='utf-8') as f:
        json.dump(trade, f, indent=2, ensure_ascii=False)
    print(f'TUR trade  → {OUT_TRADE}')


if __name__ == '__main__':
    run()
