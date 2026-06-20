# Candidate open data sources

A curated list of open data sources useful for populating EPM inputs. These are
**not currently integrated** in the Regional Power Explorer — they are kept here
for reference. Suggestions welcome via
[GitHub Issues](https://github.com/ESMAP-World-Bank-Group/regional-power-explorer/issues).

For the sources actually used by the explorer, see the in-app **Data Sources** page.

## Electricity Demand

| Source | Resolution / Coverage | Description |
|--------|----------------------|-------------|
| [Our World in Data](https://ourworldindata.org/energy) | Yearly | Historical electricity consumption by country |
| [ENTSO-E Transparency](https://transparency.entsoe.eu) | Monthly / hourly | Load profiles for European countries (hourly, SFTP) |
| [SYNDE (GEGIS)](https://github.com/Open-Poen/SYNDE) | Hourly | Modelled demand under SSP scenarios |

## Existing Generation Capacity

| Source | Resolution / Coverage | Description |
|--------|----------------------|-------------|
| [PowerPlantMatching](https://github.com/FRESNA/powerplantmatching) | Europe | Matched plant database, CSV download |

## Solar & Wind Profiles

| Source | Resolution / Coverage | Description |
|--------|----------------------|-------------|
| [Renewables.ninja](https://www.renewables.ninja) | Hourly | Simulated PV and wind capacity factors at any location |
| [Global Wind Atlas](https://globalwindatlas.info) | — | Wind resource maps and data |
| [atlite](https://atlite.readthedocs.io) | Hourly | Python library for weather-derived power profiles (ERA5) |
| [Sterl et al. 2022](https://doi.org/10.1038/s41560-021-00922-4) | — | PV and wind supply regions across Africa |

## Hydropower

| Source | Resolution / Coverage | Description |
|--------|----------------------|-------------|
| [EIA](https://www.eia.gov/international/data/world) | Yearly | Historical hydro generation by country |
| [GRDC](https://grdc.bafg.de) | Monthly | Global river discharge and runoff data |
| [FAO AQUASTAT](https://www.fao.org/aquastat) | — | Geo-referenced database of dams and reservoirs |
| [Global Dam Watch](https://globaldamwatch.org) | — | GRanD/FHReD: existing + future reservoir database |

## Comprehensive / Multi-category

| Source | Resolution / Coverage | Description |
|--------|----------------------|-------------|
| [Ember](https://ember-energy.org/data) | 85+ geographies | Global power data: generation, emissions, demand |
| [PyPSA-Earth](https://pypsa-earth.readthedocs.io) | Global | Open global electricity model with full data workflow |
| [ENERGYDATA.INFO](https://energydata.info) | Global | World Bank open data platform for the energy sector |
| [OSeMOSYS Global](https://doi.org/10.1038/s41597-021-01033-9) | Global | Global energy system data (Brinkerink et al. 2021) |
