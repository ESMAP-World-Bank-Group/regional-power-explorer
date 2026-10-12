import { dataPath } from './paths';
import { fetchData } from './dataCache';
import { inBuild } from './dataGuard';

/**
 * Files tools/build_derived_data.mjs cuts from the committed data at build
 * time. Each lookup falls back to the file it was cut from when the build has
 * no cut, so a page still works on data the script hasn't seen.
 */

/**
 * A country's slice of region_<layer>_<region>.geojson, already filtered to
 * the country the way the country page filtered it, or null when the build has
 * none (the country has no GAD outline).
 *
 * @param {string} layer  'plants', 'plants_gem', 'plants_gppd', 'lines' or 'substations'
 */
export function countryFile(regionId, iso, layer) {
  const file = `cache/country/${regionId}/${iso}_${layer}.geojson`;
  return inBuild(file) ? file : null;
}

/**
 * Each member's <kind>/<ISO>.json, or null where it has none, in the order of
 * `isos`: one request for the region's bundle instead of one per member.
 * Never rejects; a failed download reads as no file, as it did per member.
 *
 * @param {'trade'|'supply'} kind
 */
export function fetchMemberFiles(kind, regionId, isos) {
  const bundle = `${kind}/region/${regionId}.json`;
  if (inBuild(bundle)) {
    return fetchData(dataPath(bundle))
      .then(b => isos.map(iso => b[iso] ?? null))
      .catch(() => isos.map(() => null));
  }
  return Promise.all(isos.map(iso => fetchData(dataPath(`${kind}/${iso}.json`)).catch(() => null)));
}
