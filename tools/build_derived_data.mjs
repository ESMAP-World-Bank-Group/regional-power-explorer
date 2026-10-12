/**
 * Files cut from the committed data at build time, so a page downloads what it
 * shows and not its whole region. Runs before `vite build` and `vite dev`
 * (package.json prebuild/predev); the output is not committed (.gitignore).
 *
 *   cache/country/<region>/<ISO>_<layer>.geojson
 *     A country's plants (each source), lines and substations, cut from the
 *     region file with the country page's own test: points inside the
 *     country, lines with any vertex inside. It is the same pointInFeature and
 *     the same GAD geometry the page used, so the page shows what it did. A
 *     country page used to download its whole region: Luxembourg, 31 MB of
 *     Europe for 41 plants.
 *
 *   trade/region/<region>.json, supply/region/<region>.json
 *     Every member's trade/<ISO>.json and supply/<ISO>.json in one file, keyed
 *     by ISO; members without one are left out. A region page read them one
 *     request per member, 27 each for Europe.
 *
 *   zones/stats/<region>/<ISO>_<n>z.json
 *     Each zoning's per-zone plants, substations and lines, from zoneStats(),
 *     the function the Zones tab used to run on the region's files after
 *     downloading them all (some 30 MB for Europe).
 *
 * A file is rewritten only when an input is newer, so repeat runs are quick.
 *
 * Usage: node tools/build_derived_data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromTopology } from '../src/utils/topology.js';
import { pointInFeature } from '../src/utils/pointInFeature.js';
import { zoneStats } from '../src/utils/zoneStats.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
// Country file layer -> region file: region_plants_eu_gem.geojson is 'plants_gem'.
const LAYERS = {
  plants: id => `region_plants_${id}`, plants_gem: id => `region_plants_${id}_gem`,
  plants_gppd: id => `region_plants_${id}_gppd`, lines: id => `region_lines_${id}`,
  substations: id => `region_substations_${id}`,
};
const ME = fileURLToPath(import.meta.url);

const at = rel => path.join(DATA, rel);
const mtime = file => fs.statSync(file).mtimeMs;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
// Missing output, or older than any input (or than this script).
const stale = (out, inputs) => !fs.existsSync(out) || [...inputs, ME].some(i => mtime(i) > mtime(out));
function write(out, obj) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(obj));
}

const { regions } = readJson(at('regions.json'));
const started = Date.now();
let written = 0, kept = 0;

for (const region of regions) {
  const isos = (region.countries || []).map(c => c.iso);
  if (!isos.length) continue;

  for (const kind of ['trade', 'supply']) {
    const inputs = isos.map(iso => at(`${kind}/${iso}.json`)).filter(f => fs.existsSync(f));
    if (!inputs.length) continue;
    const out = at(`${kind}/region/${region.id}.json`);
    if (!stale(out, inputs)) { kept++; continue; }
    const bundle = {};
    for (const iso of isos) {
      const f = at(`${kind}/${iso}.json`);
      if (fs.existsSync(f)) bundle[iso] = readJson(f);
    }
    write(out, bundle);
    written++;
  }

  // Meta regions have no data files of their own; the guard below skips them.
  for (const [layer, name] of Object.entries(LAYERS)) {
    const src = at(`cache/${name(region.id)}.geojson`);
    if (!fs.existsSync(src)) continue;
    let fc = null;                       // parsed only if some country needs it
    for (const iso of isos) {
      const geo = at(`geo/country/${iso}.topo.json`);
      if (!fs.existsSync(geo)) continue; // the page keeps the region file then
      const out = at(`cache/country/${region.id}/${iso}_${layer}.geojson`);
      if (!stale(out, [src, geo])) { kept++; continue; }
      const feature = fromTopology(readJson(geo)).features.find(f => f.properties.ISO_A3 === iso);
      if (!feature) continue;
      fc ??= readJson(src);
      const keep = layer === 'lines'
        ? f => f.geometry.coordinates.some(c => pointInFeature(c, feature))
        : f => pointInFeature(f.geometry.coordinates, feature);
      write(out, { ...fc, features: fc.features.filter(keep) });
      written++;
    }
  }
}

// Zone stats, for the region the country page opens a country in: the first
// region, meta regions aside, that lists it (see CountryPage).
const zoneIndex = readJson(at('zones/index.json'));
const pageRegion = iso => regions.find(r => r.type !== 'meta' && (r.countries || []).some(c => c.iso === iso));
const regionFiles = new Map();   // region id -> [plants, subs, lines], parsed once
for (const [iso, runs] of Object.entries(zoneIndex)) {
  const region = pageRegion(iso);
  if (!region) continue;
  const srcs = ['plants', 'substations', 'lines'].map(l => at(`cache/region_${l}_${region.id}.geojson`));
  if (!srcs.every(f => fs.existsSync(f))) continue;
  for (const n of runs) {
    const zones = at(`zones/${iso}_${n}z_zones.geojson`);
    if (!fs.existsSync(zones)) continue;
    const out = at(`zones/stats/${region.id}/${iso}_${n}z.json`);
    if (!stale(out, [...srcs, zones])) { kept++; continue; }
    if (!regionFiles.has(region.id)) regionFiles.set(region.id, srcs.map(readJson));
    write(out, zoneStats(readJson(zones), ...regionFiles.get(region.id), iso));
    written++;
  }
}

console.log(`derived data: ${written} written, ${kept} up to date (${((Date.now() - started) / 1000).toFixed(1)} s)`);
