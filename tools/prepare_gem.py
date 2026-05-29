"""
Process GEM (Global Energy Monitor) tracker data for EPM Explorer.

The Global Integrated Power Tracker (GIPT) is downloaded automatically from:
  https://github.com/GlobalEnergyMonitor/gipt-dashboard

GIPT covers all fuel types in a single file (coal, gas, wind, solar, hydro,
nuclear, bioenergy, geothermal). The downloaded file is cached in data-source/gem/
and reused on subsequent runs unless --force is passed.

Manual fallback: place individual tracker XLSX/CSV in data-source/gem/ —
used only when GIPT download fails and no cached file exists.

Usage:
    python tools/prepare_gem.py
    python tools/prepare_gem.py --regions asean eu
    python tools/prepare_gem.py --force        # re-download GIPT even if cached
    python tools/prepare_gem.py --no-download  # manual files only
"""
import argparse
import json
import sys
import math
import re
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

import yaml

_ROOT    = Path(__file__).resolve().parents[1]
DATA_DIR = _ROOT / "data-source"
GEM_DIR  = DATA_DIR / "gem"
OUT_DIR  = DATA_DIR / "cache"
OUT_DIR.mkdir(parents=True, exist_ok=True)
GEM_DIR.mkdir(exist_ok=True)

COORD_PREC = 3

GIPT_REPO_API = "https://api.github.com/repos/GlobalEnergyMonitor/gipt-dashboard/contents/"
GIPT_RAW_BASE = "https://raw.githubusercontent.com/GlobalEnergyMonitor/gipt-dashboard/main/"

GIPT_FUEL_MAP = {
    "coal":       "coal",
    "oil/gas":    "gas",
    "solar":      "solar",
    "wind":       "wind",
    "hydropower": "hydro",
    "nuclear":    "nuclear",
    "bioenergy":  "biomass",
    "geothermal": "geothermal",
}

STATUS_MAP = {
    "operating":          "operating",
    "construction":       "construction",
    "under construction": "construction",
    "pre-construction":   "planned",
    "pre-permit":         "planned",
    "permitted":          "planned",
    "authorized":         "planned",
    "announced":          "planned",
    "discovered":         "planned",
    "proposed":           "planned",
    "shelved":            None,
    "mothballed":         None,
    "cancelled":          None,
    "retired":            None,
    "decommissioned":     None,
    "coal-to-gas":        "operating",
}

TRACKER_FUEL = [
    (re.compile(r'coal',       re.I), 'coal'),
    (re.compile(r'gas',        re.I), 'gas'),
    (re.compile(r'wind',       re.I), 'wind'),
    (re.compile(r'solar',      re.I), 'solar'),
    (re.compile(r'hydro',      re.I), 'hydro'),
    (re.compile(r'nuclear',    re.I), 'nuclear'),
    (re.compile(r'oil|petrol', re.I), 'oil'),
    (re.compile(r'biomass',    re.I), 'biomass'),
    (re.compile(r'geotherm',   re.I), 'geothermal'),
]

COUNTRY_ISO = {
    "afghanistan": "AFG", "albania": "ALB", "algeria": "DZA", "angola": "AGO",
    "argentina": "ARG", "armenia": "ARM", "australia": "AUS", "austria": "AUT",
    "azerbaijan": "AZE", "bahrain": "BHR", "bangladesh": "BGD", "belarus": "BLR",
    "belgium": "BEL", "benin": "BEN", "bhutan": "BTN", "bolivia": "BOL",
    "bosnia and herzegovina": "BIH", "botswana": "BWA", "brazil": "BRA",
    "bulgaria": "BGR", "burkina faso": "BFA", "burundi": "BDI", "cambodia": "KHM",
    "cameroon": "CMR", "canada": "CAN", "central african republic": "CAF",
    "chad": "TCD", "chile": "CHL", "china": "CHN", "colombia": "COL",
    "comoros": "COM", "congo": "COG", "congo, republic of the": "COG",
    "democratic republic of the congo": "COD", "dr congo": "COD", "drc": "COD",
    "congo, democratic republic of the": "COD",
    "costa rica": "CRI", "croatia": "HRV", "cuba": "CUB", "cyprus": "CYP",
    "czech republic": "CZE", "czechia": "CZE", "denmark": "DNK",
    "djibouti": "DJI", "dominican republic": "DOM", "ecuador": "ECU",
    "egypt": "EGY", "el salvador": "SLV", "eritrea": "ERI", "estonia": "EST",
    "eswatini": "SWZ", "swaziland": "SWZ", "ethiopia": "ETH",
    "finland": "FIN", "france": "FRA", "gabon": "GAB", "gambia": "GMB",
    "georgia": "GEO", "germany": "DEU", "ghana": "GHA", "greece": "GRC",
    "guatemala": "GTM", "guinea": "GIN", "guinea-bissau": "GNB", "haiti": "HTI",
    "honduras": "HND", "hungary": "HUN", "india": "IND", "indonesia": "IDN",
    "iran": "IRN", "iran, islamic republic of": "IRN", "iraq": "IRQ",
    "ireland": "IRL", "israel": "ISR", "italy": "ITA",
    "ivory coast": "CIV", "côte d'ivoire": "CIV", "cote d'ivoire": "CIV",
    "jamaica": "JAM", "japan": "JPN", "jordan": "JOR",
    "kazakhstan": "KAZ", "kenya": "KEN", "kosovo": "XKX", "kuwait": "KWT",
    "kyrgyzstan": "KGZ", "laos": "LAO", "lao people's democratic republic": "LAO",
    "latvia": "LVA", "lebanon": "LBN", "lesotho": "LSO", "liberia": "LBR",
    "libya": "LBY", "lithuania": "LTU", "luxembourg": "LUX",
    "madagascar": "MDG", "malawi": "MWI", "malaysia": "MYS", "maldives": "MDV",
    "mali": "MLI", "mauritania": "MRT", "mauritius": "MUS", "mexico": "MEX",
    "moldova": "MDA", "mongolia": "MNG", "montenegro": "MNE", "morocco": "MAR",
    "mozambique": "MOZ", "myanmar": "MMR", "namibia": "NAM", "nepal": "NPL",
    "netherlands": "NLD", "new zealand": "NZL", "nicaragua": "NIC",
    "niger": "NER", "nigeria": "NGA", "north korea": "PRK",
    "korea, democratic people's republic of": "PRK",
    "north macedonia": "MKD", "norway": "NOR", "oman": "OMN",
    "pakistan": "PAK", "palestine": "PSE", "state of palestine": "PSE",
    "west bank and gaza": "PSE", "panama": "PAN", "papua new guinea": "PNG",
    "paraguay": "PRY", "peru": "PER", "philippines": "PHL", "poland": "POL",
    "portugal": "PRT", "qatar": "QAT", "romania": "ROU",
    "russia": "RUS", "russian federation": "RUS", "rwanda": "RWA",
    "saudi arabia": "SAU", "senegal": "SEN", "serbia": "SRB",
    "sierra leone": "SLE", "somalia": "SOM", "south africa": "ZAF",
    "south korea": "KOR", "korea, republic of": "KOR",
    "south sudan": "SSD", "spain": "ESP", "sri lanka": "LKA",
    "sudan": "SDN", "sweden": "SWE", "switzerland": "CHE",
    "syria": "SYR", "syrian arab republic": "SYR",
    "taiwan": "TWN", "tajikistan": "TJK",
    "tanzania": "TZA", "united republic of tanzania": "TZA",
    "thailand": "THA", "togo": "TGO", "trinidad and tobago": "TTO",
    "tunisia": "TUN", "turkey": "TUR", "türkiye": "TUR",
    "turkmenistan": "TKM", "uganda": "UGA", "ukraine": "UKR",
    "united arab emirates": "ARE", "uae": "ARE",
    "united kingdom": "GBR", "uk": "GBR",
    "united states": "USA", "usa": "USA", "united states of america": "USA",
    "uruguay": "URY", "uzbekistan": "UZB", "venezuela": "VEN",
    "viet nam": "VNM", "vietnam": "VNM", "yemen": "YEM",
    "zambia": "ZMB", "zimbabwe": "ZWE",
    "brunei": "BRN", "brunei darussalam": "BRN",
    "timor-leste": "TLS", "east timor": "TLS",
    "singapore": "SGP",
}

ISO2_TO_ISO3 = {
    "AF":"AFG","AL":"ALB","DZ":"DZA","AO":"AGO","AR":"ARG","AM":"ARM",
    "AU":"AUS","AT":"AUT","AZ":"AZE","BH":"BHR","BD":"BGD","BY":"BLR",
    "BE":"BEL","BJ":"BEN","BT":"BTN","BO":"BOL","BA":"BIH","BW":"BWA",
    "BR":"BRA","BG":"BGR","BF":"BFA","BI":"BDI","KH":"KHM","CM":"CMR",
    "CA":"CAN","CF":"CAF","TD":"TCD","CL":"CHL","CN":"CHN","CO":"COL",
    "KM":"COM","CG":"COG","CD":"COD","CR":"CRI","HR":"HRV","CU":"CUB",
    "CY":"CYP","CZ":"CZE","DK":"DNK","DJ":"DJI","DO":"DOM","EC":"ECU",
    "EG":"EGY","SV":"SLV","ER":"ERI","EE":"EST","SZ":"SWZ","ET":"ETH",
    "FI":"FIN","FR":"FRA","GA":"GAB","GM":"GMB","GE":"GEO","DE":"DEU",
    "GH":"GHA","GR":"GRC","GT":"GTM","GN":"GIN","GW":"GNB","HT":"HTI",
    "HN":"HND","HU":"HUN","IN":"IND","ID":"IDN","IR":"IRN","IQ":"IRQ",
    "IE":"IRL","IL":"ISR","IT":"ITA","CI":"CIV","JM":"JAM","JP":"JPN",
    "JO":"JOR","KZ":"KAZ","KE":"KEN","XK":"XKX","KW":"KWT","KG":"KGZ",
    "LA":"LAO","LV":"LVA","LB":"LBN","LS":"LSO","LR":"LBR","LY":"LBY",
    "LT":"LTU","LU":"LUX","MG":"MDG","MW":"MWI","MY":"MYS","MV":"MDV",
    "ML":"MLI","MR":"MRT","MU":"MUS","MX":"MEX","MD":"MDA","MN":"MNG",
    "ME":"MNE","MA":"MAR","MZ":"MOZ","MM":"MMR","NA":"NAM","NP":"NPL",
    "NL":"NLD","NZ":"NZL","NI":"NIC","NE":"NER","NG":"NGA","KP":"PRK",
    "MK":"MKD","NO":"NOR","OM":"OMN","PK":"PAK","PS":"PSE","PA":"PAN",
    "PG":"PNG","PY":"PRY","PE":"PER","PH":"PHL","PL":"POL","PT":"PRT",
    "QA":"QAT","RO":"ROU","RU":"RUS","RW":"RWA","SA":"SAU","SN":"SEN",
    "RS":"SRB","SL":"SLE","SO":"SOM","ZA":"ZAF","KR":"KOR","SS":"SSD",
    "ES":"ESP","LK":"LKA","SD":"SDN","SE":"SWE","CH":"CHE","SY":"SYR",
    "TW":"TWN","TJ":"TJK","TZ":"TZA","TH":"THA","TG":"TGO","TT":"TTO",
    "TN":"TUN","TR":"TUR","TM":"TKM","UG":"UGA","UA":"UKR","AE":"ARE",
    "GB":"GBR","US":"USA","UY":"URY","UZ":"UZB","VE":"VEN","VN":"VNM",
    "YE":"YEM","ZM":"ZMB","ZW":"ZWE","BN":"BRN","SG":"SGP","TL":"TLS",
}


def detect_fuel(filename):
    for pattern, fuel in TRACKER_FUEL:
        if pattern.search(filename):
            return fuel
    return None


def name_to_iso(name):
    if not name:
        return None
    s = str(name).strip()
    if len(s) == 3 and s.isupper():
        return s
    if len(s) == 2 and s.isupper():
        return ISO2_TO_ISO3.get(s)
    return COUNTRY_ISO.get(s.lower())


def map_status(raw):
    if not raw or str(raw).strip().lower() in ('nan', 'none', ''):
        return "operating"
    key = str(raw).strip().lower()
    return STATUS_MAP.get(key)


def find_col(df, *candidates):
    cols_lower = {c.strip().lower(): c for c in df.columns}
    for cand in candidates:
        match = cols_lower.get(cand.strip().lower())
        if match:
            return match
    return None


def process_file(path, fuel):
    import pandas as pd
    if path.suffix.lower() in ('.xlsx', '.xls'):
        df = pd.read_excel(path, engine='openpyxl')
    else:
        df = pd.read_csv(path, low_memory=False)
    print(f"    {len(df):,} rows, columns: {list(df.columns[:8])}")

    lat_col  = find_col(df, 'latitude', 'lat')
    lon_col  = find_col(df, 'longitude', 'lon', 'long')
    mw_col   = find_col(df, 'capacity (mw)', 'capacity_mw', 'mw', 'capacity',
                        'total capacity (mw)', 'installed capacity (mw)')
    stat_col = find_col(df, 'status')
    name_col = find_col(df, 'plant name', 'unit name', 'project name', 'name', 'unit')
    year_col = find_col(df, 'start year', 'commissioning year', 'start_year',
                        'online year', 'year online', 'year')
    ctry_col = find_col(df, 'country')

    if not lat_col or not lon_col:
        print(f"    ! No lat/lon columns — skipping {path.name}")
        return []

    plants = []
    for _, row in df.iterrows():
        try:
            lat = float(row[lat_col])
            lon = float(row[lon_col])
            if math.isnan(lat) or math.isnan(lon):
                continue
        except (ValueError, TypeError):
            continue

        raw_status = row[stat_col] if stat_col else None
        status = map_status(raw_status)
        if status is None:
            continue

        mw = None
        if mw_col:
            try:
                v = float(row[mw_col])
                if not math.isnan(v) and not math.isinf(v) and v > 0:
                    mw = round(v, 1)
            except (ValueError, TypeError):
                pass

        name = ''
        if name_col:
            raw_name = row[name_col]
            if raw_name == raw_name:
                name = str(raw_name).strip()

        country_raw = str(row[ctry_col]).strip() if ctry_col else None
        iso = name_to_iso(country_raw) if country_raw else None

        year = None
        if year_col:
            try:
                yv = float(row[year_col])
                if not math.isnan(yv) and 1900 <= yv <= 2040:
                    year = int(yv)
            except (ValueError, TypeError):
                pass

        plants.append({
            "lat":     round(lat, COORD_PREC),
            "lon":     round(lon, COORD_PREC),
            "name":    name,
            "fuel":    fuel,
            "mw":      mw,
            "country": iso,
            "status":  status,
            "year":    year,
        })

    return plants


def build_capacity(plants):
    capacity = {}
    for p in plants:
        if p.get("status") != "operating":
            continue
        iso = p.get("country")
        mw  = p.get("mw")
        if not iso or not mw:
            continue
        capacity.setdefault(iso, {})
        fuel = p["fuel"]
        capacity[iso][fuel] = round(capacity[iso].get(fuel, 0) + mw, 1)
    return capacity


def load_regions(only=None):
    with open(DATA_DIR / "regions.yaml", encoding="utf-8") as f:
        regions = [r for r in yaml.safe_load(f)["regions"] if r["status"] == "available"]
    if only:
        regions = [r for r in regions if r["id"] in only]
    return regions


def fetch_gipt_file(force=False):
    """Download the latest GIPT xlsx from GitHub. Returns local Path or None."""
    print("  Checking GitHub for latest GIPT release...")
    try:
        req = urllib.request.Request(GIPT_REPO_API, headers={"User-Agent": "prepare_gem.py"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            files = json.loads(resp.read())
    except Exception as e:
        print(f"  ! GitHub API error: {e}")
        return None

    gipt_files = [
        f for f in files
        if f["name"].startswith("Global Integrated Power") and f["name"].endswith(".xlsx")
    ]
    if not gipt_files:
        print("  ! No GIPT xlsx found in GitHub repo root")
        return None

    latest = sorted(gipt_files, key=lambda f: f["name"])[-1]
    name = latest["name"]
    dest = GEM_DIR / f"_gipt_{name}"

    if dest.exists() and not force:
        print(f"  Using cached: {dest.name}")
        return dest

    url = GIPT_RAW_BASE + urllib.parse.quote(name)
    print(f"  Downloading: {name}")
    try:
        urllib.request.urlretrieve(url, dest)
        size_mb = dest.stat().st_size / 1_000_000
        print(f"  Downloaded {size_mb:.1f} MB -> {dest.name}")
        return dest
    except Exception as e:
        print(f"  ! Download failed: {e}")
        if dest.exists():
            dest.unlink()
        return None


def normalize_gipt_status(raw):
    """Normalize GIPT status variants like 'cancelled - inferred 4 y' → 'cancelled'."""
    if not raw or str(raw).strip().lower() in ('nan', 'none', ''):
        return None
    s = str(raw).strip().lower()
    s = re.sub(r'\s*-\s*inferred\s+\d+\s*y.*$', '', s).strip()
    return s


def process_gipt(path):
    """Process GIPT xlsx — all fuel types in one file via the 'Type' column."""
    import pandas as pd

    print(f"  Reading sheet 'Power facilities'...")
    df = pd.read_excel(path, sheet_name='Power facilities', engine='openpyxl')
    df.replace('not found', pd.NA, inplace=True)
    print(f"  {len(df):,} rows, columns: {list(df.columns[:10])}")

    lat_col  = find_col(df, 'latitude', 'lat')
    lon_col  = find_col(df, 'longitude', 'lon', 'long')
    mw_col   = find_col(df, 'capacity (mw)', 'capacity_mw', 'mw', 'capacity')
    stat_col = find_col(df, 'status')
    name_col = find_col(df, 'plant / project name', 'plant name', 'project name', 'name')
    year_col = find_col(df, 'start year', 'commissioning year', 'year')
    ctry_col = find_col(df, 'country/area', 'country')
    type_col = find_col(df, 'type')

    if not lat_col or not lon_col:
        print(f"  ! No lat/lon columns in GIPT file — aborting")
        return []
    if not type_col:
        print(f"  ! No 'Type' column in GIPT file — aborting")
        return []

    plants = []
    skipped_types = set()

    for _, row in df.iterrows():
        try:
            lat = float(row[lat_col])
            lon = float(row[lon_col])
            if math.isnan(lat) or math.isnan(lon):
                continue
        except (ValueError, TypeError):
            continue

        raw_type = str(row[type_col]).strip().lower() if pd.notna(row[type_col]) else ''
        fuel = GIPT_FUEL_MAP.get(raw_type)
        if not fuel:
            skipped_types.add(raw_type)
            continue

        normalized = normalize_gipt_status(row[stat_col] if stat_col else None)
        status = map_status(normalized)
        if status is None:
            continue

        mw = None
        if mw_col:
            try:
                v = float(row[mw_col])
                if not math.isnan(v) and not math.isinf(v) and v > 0:
                    mw = round(v, 1)
            except (ValueError, TypeError):
                pass

        name = ''
        if name_col and pd.notna(row[name_col]):
            name = str(row[name_col]).strip()

        country_raw = str(row[ctry_col]).strip() if ctry_col and pd.notna(row[ctry_col]) else None
        iso = name_to_iso(country_raw) if country_raw else None

        year = None
        if year_col:
            try:
                yv = float(row[year_col])
                if not math.isnan(yv) and 1900 <= yv <= 2040:
                    year = int(yv)
            except (ValueError, TypeError):
                pass

        plants.append({
            "lat":     round(lat, COORD_PREC),
            "lon":     round(lon, COORD_PREC),
            "name":    name,
            "fuel":    fuel,
            "mw":      mw,
            "country": iso,
            "status":  status,
            "year":    year,
        })

    if skipped_types - {'', 'nan'}:
        print(f"  Skipped unknown fuel types: {skipped_types - {'', 'nan'}}")
    return plants


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--regions", nargs="+", metavar="ID",
                        help="Only process these region IDs (e.g. --regions asean eu)")
    parser.add_argument("--force", action="store_true",
                        help="Re-download GIPT even if a cached file exists")
    parser.add_argument("--no-download", action="store_true",
                        help="Skip auto-download and use manual files in data-source/gem/ only")
    args = parser.parse_args()

    try:
        import pandas as pd
        import openpyxl  # noqa: F401
    except ImportError:
        print("Missing dependency — run: pip install pandas openpyxl")
        sys.exit(1)

    all_plants = []

    # --- Auto-download GIPT (default) ---
    if not args.no_download:
        gipt_path = fetch_gipt_file(force=args.force)
        if gipt_path:
            print(f"\nProcessing GIPT: {gipt_path.name}")
            plants = process_gipt(gipt_path)
            op = sum(1 for p in plants if p["status"] == "operating")
            co = sum(1 for p in plants if p["status"] == "construction")
            pl = sum(1 for p in plants if p["status"] == "planned")
            print(f"  {len(plants):,} total  ({op} operating, {co} construction, {pl} planned)")
            all_plants.extend(plants)
        else:
            print("  GIPT auto-download failed — falling back to manual files")

    # --- Fallback: manual tracker files ---
    if not all_plants:
        manual_files = [
            f for f in (
                list(GEM_DIR.glob("*.xlsx")) +
                list(GEM_DIR.glob("*.xls")) +
                list(GEM_DIR.glob("*.csv"))
            )
            if not f.name.startswith("_gipt_")  # exclude cached GIPT downloads
        ]
        if not manual_files:
            print(f"\nNo data available: GIPT download failed and no manual files in {GEM_DIR}")
            print("Either check your internet connection or download tracker files from:")
            print("  https://globalenergymonitor.org/projects/")
            sys.exit(1)

        for path in manual_files:
            fuel = detect_fuel(path.name)
            if not fuel:
                print(f"  ? Skipping {path.name} — can't detect fuel type from filename")
                continue
            print(f"\n  Processing {path.name}  →  fuel: {fuel}")
            plants = process_file(path, fuel)
            op = sum(1 for p in plants if p["status"] == "operating")
            co = sum(1 for p in plants if p["status"] == "construction")
            pl = sum(1 for p in plants if p["status"] == "planned")
            print(f"    {len(plants):,} total  ({op} operating, {co} construction, {pl} planned)")
            all_plants.extend(plants)

    print(f"\nTotal: {len(all_plants):,} plants")

    regions = load_regions(only=set(args.regions) if args.regions else None)
    for region in regions:
        iso_set = {c["iso"] for c in region["countries"]}
        sub = [p for p in all_plants if p.get("country") in iso_set]
        if not sub:
            print(f"\n{region['name']}: 0 plants — skipping")
            continue
        print(f"\n{region['name']} ({region['id']}): {len(sub)} plants")

        rid = region["id"]
        out_plants = OUT_DIR / f"region_plants_{rid}_gem.json"
        with open(out_plants, "w", encoding="utf-8") as f:
            json.dump(sub, f, separators=(",", ":"), ensure_ascii=False)
        print(f"  Saved {out_plants.name}")

        capacity = build_capacity(sub)
        out_cap = OUT_DIR / f"region_capacity_{rid}_gem.json"
        with open(out_cap, "w", encoding="utf-8") as f:
            json.dump({"countries": capacity}, f, separators=(",", ":"))
        print(f"  Saved {out_cap.name}")

    print("\nDone. Run prepare_data.py to convert to GeoJSON for the app.")
