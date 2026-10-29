# Data lineage and update frequency

Where the data the explorer and its AI assistant use comes from, how it reaches
`public/data/`, and how often it is refreshed. Sources, versions and licences
for each layer are on the in-app Data Sources page (`src/pages/AboutPage.jsx`).

Nothing is fetched from an outside service while a visitor uses the app. Every
file is built ahead of time, committed, and served with the app. The deployed
site changes only when it is rebuilt and uploaded to Design Studio (by hand
today; see `GOING_FORWARD.md`), so even daily data reaches users only on the
next deployment.

## Three kinds of file

1. **Published data**: built from outside sources by the pipelines in
   `tools/`. The map, the dashboard tabs and the assistant read these.
2. **Derived summaries**: small files computed from the published data for
   the region page and the assistant, because the plant and line files are too
   big to read on demand (up to 21 MB). They must be regenerated whenever their
   inputs change. CI checks this (below).
3. **Resource figures**: country solar and wind figures built from outside
   atlases by `tools/prepare_re.py` (see `RE_RESOURCES_METHOD.md`).

## Lineage

| Data | Source → pipeline → file | Read by | Source updates | Explorer file refreshed |
|---|---|---|---|---|
| Supply (generation, capacity, demand) | National statistics, Ember/OWID, ENTSO-E → `tools/build_all.py` → `supply/<ISO3>.json` | Supply and Load tabs; `data__supply` | Mostly yearly | By hand (`metadata.json` records the last update) |
| Trade | National statistics, power-pool secretariats, ENTSO-E, UN Comtrade → `tools/build_all.py` → `trade/<ISO3>.json` | Supply tab; `data__trade` | Yearly | By hand |
| Market prices (Türkiye) | EPİAŞ → `tools/pipelines/epias_pipeline.py` → `market/TUR.json` | Market tab; `data__market` | Daily | **Daily, automatic** (`epias-daily-update.yml`, 03:00 UTC) |
| Access, tariffs | World Bank WDI / SE4All; IRENA, utilities → `access.json`, `tariffs.json` | Country pages; `data__indicators` | Yearly / irregular | By hand |
| Plants | GEM, WRI GPPD, OpenStreetMap → `prepare_gem.py`, `prepare_gppd.py`, OSM extract → `cache/region_plants_<region>[_gem\|_gppd].geojson` | Maps; Zoning tab | GEM about twice a year; GPPD frozen since 2021; OSM continuous | By hand |
| Lines, substations | OpenStreetMap → `prepare_lines.py` → `cache/region_lines_*`, `cache/region_substations_*` | Maps; Zoning tab | Continuous | By hand (can't be automated yet) |
| Capacity by region | Plant files → pipeline → `cache/region_capacity_*`, `cache/region_age_*_gppd.json` | Region page; `data__capacity` | With the plant files | With the plant files |
| Planning-model zones | EPM model zones → `zones/` | Zoning tab | When the model is rerun | By hand |
| Country briefing notes | AI-drafted HTML → `notes/<ISO3>.html` | Country page; `data__country_note` | Ad hoc | By hand (most dated June 2026) |
| Load centres (Black Sea) | `region_load_centers_blacksea.geojson` | Country page; `data__load_centres` | Ad hoc | By hand |
| **Derived:** region summaries | Plant and line files → `prepare_region_summary.py` → `cache/region_summary_<region>.json` | Region page | With its inputs | **Checked by CI** |
| **Derived:** plants and pipeline | Plant files → `prepare_ai.py` → `ai/plants/<ISO3>.json` | `data__pipeline`, `data__plants` | With its inputs | **Checked by CI** |
| **Derived:** grid | Line and substation files → `prepare_ai.py` → `ai/grid/<region>.json` | `data__grid` | With its inputs | **Checked by CI** |
| **Derived:** zones | Zone files + OSM plant files → `prepare_ai.py` → `ai/zones/<ISO3>.json` | `data__zones` | With its inputs | **Checked by CI** |
| Solar resource | Global Solar Atlas country statistics → `prepare_re.py` → `re/<ISO3>.json` | RE tab; `data__re_resources` | About yearly (new atlas versions) | By hand, about once a year |
| Wind resource | Global Wind Atlas v4 → `prepare_re.py` → `re/<ISO3>.json` | RE tab; `data__re_resources` | Every few years | By hand, about once a year |
| Monthly solar and wind profiles | NASA POWER climatology → `prepare_re.py` → `re/<ISO3>.json` | RE tab; `data__re_resources` | Rarely | With the resource figures |

## Keeping derived summaries in step

The derived summaries copy facts from the plant, line and zone files. If those
files change and the summaries don't, the assistant answers from older data than
the map shows. After any pipeline step that rewrites plant, line or zone files:

```bash
python tools/prepare_region_summary.py
python tools/prepare_ai.py
```

Then commit `public/data/cache/region_summary_*.json` and `public/data/ai/`
together with the change.

`.github/workflows/check-derived-data.yml` enforces this. On every pull request
and push to `main` that touches `public/data/` or the two scripts, it reruns
both scripts and fails if the output differs from what is committed. Both
scripts are deterministic and use only the Python standard library, so the check
needs no setup.

This is a check, not a build step: the derived files stay committed so changes
are reviewed like any other data, and `npm run build` does not need Python.
