# Digital infrastructure layers for the Regional Power Explorer — handoff 2026-10-13

Countries: Ukraine (UKR), Georgia (GEO), Armenia (ARM), Azerbaijan (AZE), Moldova (MDA).
Repo regions: UKR and MDA are in `entsoe`; GEO, ARM and AZE are in `blacksea`.
All geometry is EPSG:4326 (lon/lat). All text is UTF-8 without BOM, LF line endings. File names are ASCII.

The app has no digital layer yet, so these files need a new map layer (and a Data Sources entry) in `src/`.
Country assignment uses the World Bank boundaries the app itself uses (`public/data/geo/country/<ISO>.topo.json`).

## Folder layout

- `rpe_digital_infra_2026-10-13.gpkg` — full-precision source for the pipeline; raw input, delivered separately (not in git).
  Layers: itu_backbone, itu_nodes, facilities_itu, submarine_cables,
  opennet_backbone, opennet_pop, orange_fibre, orange_coverage.
- `public/data/digital/` — web-ready files.
  Coordinates rounded to 5 decimals; compact JSON.
- `data-source/sources/DIGITAL.yaml` — source registry in the format of `data-source/sources/<ISO>.yaml`.
- `docs/digital-infrastructure/validation_report.txt` — sizes, counts, encoding, CRS and geometry checks of every output.

## Contents per country

| ISO | ITU backbone (segments / km in country) | ITU nodes | Landing points | Earth stations |
|---|---|---|---|---|
| UKR | 584 / 33893 | 311 | 0 | 7 |
| GEO | 107 / 3516 | 59 | 1 | 0 |
| ARM | 73 / 2285 | 55 | 0 | 2 |
| AZE | 63 / 2187 | 54 | 1 | 0 |
| MDA | 112 / 3333 | 45 | 0 | 35 |

- Georgia, Open Net: 768 line segments; km by status: design 472, operational 1029, under_construction 815.
  Points of presence by status: operational 300, under_construction 193, design 126.
- Moldova, Orange: fibre 84790 segments (~8991 km); the web file is one dissolved network geometry
  showing ~7805 km (34291 pieces; pieces under 50 m — mostly drop cables — left out);
  outdoor coverage, % of territory: 2g 94.4, 3g 97.5, 4g 96.1, 5g 2.4.
- Submarine cables landing in the five countries: 3 (full geometry, not clipped).
- `itu_indicators.json`: 204 countries (global, limited to the app's country codes), keyed like `access.json`.

## Web files and properties

| File | Geometry | Properties |
|---|---|---|
| `itu_indicators.json` | — | countries.ISO: gci2024_tier, tracker2024_generation, g5_2021/2023/2025, pop_within_10km_fibre_pct, nms_mapscore, bp_score |
| `<ISO>_backbone_itu.geojson` | (Multi)LineString, clipped to the country | itu_id, operator, from, to, status, type, length_km_src, km, golive, cross_border |
| `<ISO>_nodes_itu.geojson` | Point | itu_id, name, type, status, itu_country, validity |
| `<ISO>_facilities_itu.geojson` | Point | kind (landing_point / earth_station), source_id, name, satellite |
| `submarine_cables.geojson` | (Multi)LineString | itu_id, name, owners, rfs, length_km, landing_iso |
| `GEO_backbone_opennet.geojson` | LineString | on_id, routeid, status, km |
| `GEO_pop_opennet.geojson` | Point | on_id, popid, name, address, status, pop_type, point_role, services, available, population, households |
| `MDA_fibre_orange.geojson` | MultiLineString (1 feature) | network, km_shown, km_total, pieces |
| `MDA_coverage_orange.geojson` | (Multi)Polygon, clipped to MDA | tech (2g/3g/4g/5g), territory_pct |

`status` uses one vocabulary everywhere: operational, under_construction, planned, proposed, design.
`km` is the geodesic length inside the country; `length_km_src` is the length stated by the source.
`cross_border` is true when the source segment continues outside the country.

## Transformations

- Reprojected EPSG:3857 sources (ITU earth stations, Orange) to EPSG:4326.
- ITU lines clipped to each country polygon, fragments under 50 m dropped; go-live dates `YYYYMMDD` → ISO dates, `0` → null.
- ITU nodes stored as MultiPoint upstream → single points; deduplicated on ITU id.
- Earth stations kept only where the ITU administration code matches the country they fall in.
- Submarine cables Kerch Strait Cable; Energy Bridge Cable were removed by decision of the World Bank team, together with the landing points
  that serve only them and the ITU terrestrial record of the same link: 21161 (PJSC Rostelecom, Novorossiysk -> Kerch).
- Orange coverage: one multipolygon per technology; web file clipped to MDA and simplified (0.0005°).
- Orange fibre: web file dissolves all segments into one network, drops pieces under 50 m and
  simplifies (0.0001°); raw keeps all segments with cable names.
- Orange coverage polygons are invalid in the source (self-intersections): kept as received in raw, repaired in web.
- Dropped from ITU source: the local file path field and the t131…t152 flags.

## Limitations

- ITU geocoding is coarse; points were checked against country polygons (see the validation report).
- Orange coverage is the operator's modelled outdoor coverage, not measured.

## Rights and restrictions — read before publishing

- Boundaries shown do not imply any judgment on the legal status of any territory.
