/**
 * Where the interaction geometry (country and non-determined area fills,
 * hover, click) comes from: the World Bank GAD vector tile service when it is
 * usable, otherwise the static GAD extract in public/data/geo.
 *
 * "Usable" is checked, not assumed, once per browser session: the service
 * must answer without a token and a sample tile must carry the attributes the
 * pages key on (ISO_A3 on countries, NAM_0 on areas). A tileset published
 * with Unique Values symbology fails this -- ArcGIS then writes only a
 * `_symbol` class index into the tiles -- and so does a private one. Either
 * way the map falls back to the static files and nothing breaks; when the
 * service is republished with real attributes the tiles take over without a
 * redeploy.
 *
 * Borders are never drawn from this geometry; they come from the Bank's own
 * boundary lines in the basemap style (src/utils/wbStyle.js).
 */

// Override at build time with VITE_GAD_TILES_URL once the ADM0 + NDLSA
// tileset is republished; set it to 'off' to skip the probe entirely.
const DEFAULT_SERVICE = 'https://tiles.arcgis.com/tiles/iQ1dY19aHwbSDYIF/arcgis/rest/services/WB_GAD_Polygons_012/VectorTileServer';
const SERVICE = import.meta.env.VITE_GAD_TILES_URL || DEFAULT_SERVICE;

export const ADM0_LAYER = import.meta.env.VITE_GAD_ADM0_LAYER || 'WB_GAD_ADM0';
export const NDLSA_LAYER = import.meta.env.VITE_GAD_NDLSA_LAYER || 'World_Bank_Official_Boundaries___NDLSA';
/** The Bank's name field on the areas; the key the NDLSA policy table joins on. */
export const NAME_PROP = 'NAM_0';

// ArcGIS publishes 512 px tiles; this service's cache stops at LOD 10 and
// MapLibre overzooms from there.
const TILE_SIZE = 512;
const MAX_ZOOM = 10;
// A mid-zoom tile over North Africa / the Middle East: small enough to fetch
// quickly, sure to hold both countries and non-determined areas.
const PROBE_TILE = '3/3/4';
const PROBE_TIMEOUT_MS = 5000;
const CACHE_KEY = `rpe:gad-mode:${SERVICE}`;

/** Vector source spec for the tiles; hover uses the promoted ids. */
export function geoTileSourceSpec() {
  return {
    type: 'vector',
    tiles: [`${SERVICE}/tile/{z}/{y}/{x}.pbf`],
    tileSize: TILE_SIZE,
    minzoom: 0,
    maxzoom: MAX_ZOOM,
    promoteId: { [ADM0_LAYER]: 'ISO_A3', [NDLSA_LAYER]: NAME_PROP },
  };
}

async function probe() {
  if (SERVICE === 'off') return 'static';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVICE}/tile/${PROBE_TILE}.pbf`, { signal: ctrl.signal });
    // A private service answers 200 with a JSON "Token Required" body.
    if (!res.ok || !/octet-stream|protobuf/.test(res.headers.get('content-type') || '')) return 'static';
    const [{ VectorTile }, { default: Pbf }] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);
    const tile = new VectorTile(new Pbf(await res.arrayBuffer()));
    const first = name => (tile.layers[name]?.length ? tile.layers[name].feature(0).properties : null);
    const adm0 = first(ADM0_LAYER), area = first(NDLSA_LAYER);
    return adm0 && 'ISO_A3' in adm0 && (!area || NAME_PROP in area) ? 'tiles' : 'static';
  } catch {
    return 'static';
  } finally {
    clearTimeout(timer);
  }
}

let modePromise = null;
/** 'tiles' or 'static', decided once per session. */
export function resolveGeoMode() {
  if (!modePromise) {
    let cached = null;
    try { cached = sessionStorage.getItem(CACHE_KEY); } catch { /* storage blocked */ }
    modePromise = cached === 'tiles' || cached === 'static'
      ? Promise.resolve(cached)
      : probe().then(mode => {
        try { sessionStorage.setItem(CACHE_KEY, mode); } catch { /* storage blocked */ }
        return mode;
      });
  }
  return modePromise;
}
