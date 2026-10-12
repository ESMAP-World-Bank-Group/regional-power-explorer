import { pointInFeature } from './pointInFeature.js';

// No other imports: tools/build_derived_data.mjs runs this under Node to write
// each zoning's stats at build time, and the Zones tab falls back to it in the
// browser when the build has none, so the two can never disagree.

/**
 * Per-zone plants (MW by fuel, count), substations and lines for one zoning:
 * a plant or substation counts in the zone it falls in, a line in the zone of
 * its middle vertex. Plants are those tagged with the country or untagged.
 *
 * @param {object} zonesGJ  zones/<ISO>_<n>z_zones.geojson
 * @param {object} plants   region_plants_<region>.geojson (OSM)
 * @param {object} subs     region_substations_<region>.geojson
 * @param {object} lines    region_lines_<region>.geojson
 * @returns {Object<string, {fuels: Object<string, number>, totalMw: number, plantCount: number, subCount: number, lineCount: number}>}
 */
export function zoneStats(zonesGJ, plants, subs, lines, iso) {
  const stats = {};
  zonesGJ.features.forEach(zf => {
    stats[zf.properties.zone_name] = { fuels: {}, totalMw: 0, plantCount: 0, subCount: 0, lineCount: 0 };
  });

  // Filter plants to current country
  const countryPlants = plants.features.filter(f => {
    const iso3 = f.properties.country || f.properties.ISO_A3 || '';
    return !iso3 || iso3 === iso;
  });

  for (const pf of countryPlants) {
    const coords = pf.geometry.coordinates;
    for (const zf of zonesGJ.features) {
      if (pointInFeature(coords, zf)) {
        const name = zf.properties.zone_name;
        const fuel = pf.properties.fuel;
        const mw   = pf.properties.mw || 0;
        if (fuel) stats[name].fuels[fuel] = (stats[name].fuels[fuel] || 0) + mw;
        stats[name].totalMw  += mw;
        stats[name].plantCount++;
        break;
      }
    }
  }

  // Substations PIP. pointInFeature keeps each zone's bounding boxes itself, so
  // a zone far from the point is turned away without a ray cast. (Boxes built
  // from geometry.coordinates once crashed the tab on Sudan, whose zones
  // include a GeometryCollection, which has none.)
  for (const sf of subs.features) {
    const [sx, sy] = sf.geometry.coordinates;
    for (let i = 0; i < zonesGJ.features.length; i++) {
      if (pointInFeature([sx, sy], zonesGJ.features[i])) {
        stats[zonesGJ.features[i].properties.zone_name].subCount++;
        break;
      }
    }
  }

  // Lines PIP — use midpoint of each line segment
  for (const lf of lines.features) {
    const coords = lf.geometry.coordinates;
    if (!coords?.length) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    const [lx, ly] = mid;
    for (let i = 0; i < zonesGJ.features.length; i++) {
      if (pointInFeature([lx, ly], zonesGJ.features[i])) {
        stats[zonesGJ.features[i].properties.zone_name].lineCount++;
        break;
      }
    }
  }

  return stats;
}
