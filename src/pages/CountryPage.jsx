import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { track } from '../analytics';
import maplibregl from 'maplibre-gl';
import { useTheme } from '../App';
import { getT, mapStyle, swapBasemap, toggleSatLabels, FUEL_COLORS, VOLTAGE_BRACKETS, plantRadiusExpr, lcRadiusExpr } from '../constants';
import LayerPanel from '../components/LayerPanel';
import CountryOverview from '../components/CountryOverview';
import REResourcesTab from '../components/tabs/REResourcesTab';
import LoadTab from '../components/tabs/LoadTab';
import ZoningTab from '../components/tabs/ZoningTab';
import SupplyTab from '../components/tabs/SupplyTab';

function buildPlantFilter(fuel, mw, statusOff) {
  const clauses = [
    ['==', ['get', 'fuel'], fuel],
    ['>=', ['get', 'mw'], mw],
  ];
  if (statusOff.size > 0)
    clauses.push(['!', ['in', ['get', 'status'], ['literal', [...statusOff]]]]);
  return ['all', ...clauses];
}

function lineKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1], [lon2, lat2] = coords[i];
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    km += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return km;
}

function Row({ label, value, t }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:8, marginBottom:3 }}>
      <span style={{ color: t.lblMuted, flexShrink:0 }}>{label}</span>
      <span style={{ color: t.lbl, fontWeight:600, textAlign:'right' }}>{value}</span>
    </div>
  );
}

function downloadBlob(content, filename, type = 'application/octet-stream') {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Ray-casting point-in-polygon (handles Polygon + MultiPolygon)
function pointInRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function pointInFeature(pt, feature) {
  const g = feature.geometry;
  if (g.type === 'Polygon')
    return g.coordinates.some(ring => pointInRing(pt, ring));
  if (g.type === 'MultiPolygon')
    return g.coordinates.some(poly => poly.some(ring => pointInRing(pt, ring)));
  return false;
}

function fitBoundsCountry(iso, countries) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const f of countries.features) {
    if (f.properties.ISO_A3 !== iso) continue;
    const geom = f.geometry;
    const rings = geom.type === 'Polygon'
      ? geom.coordinates
      : geom.coordinates.flatMap(p => p);
    for (const ring of rings)
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      }
  }
  if (!isFinite(minLon)) return null;
  return [[minLon - 0.8, minLat - 0.8], [maxLon + 0.8, maxLat + 0.8]];
}

export default function CountryPage() {
  const { iso }      = useParams();
  const { theme }    = useTheme();
  const t            = getT(theme);

  const containerRef = useRef(null);
  const mapRef       = useRef(null);

  const [info,         setInfo]         = useState(null);  // { country, region }
  const [presentFuels, setPresentFuels] = useState(new Set());
  const [fuelsOff,     setFuelsOff]     = useState(new Set());
  const [statusOff,    setStatusOff]    = useState(new Set(['planned']));
  const [kvsOff,       setKvsOff]       = useState(new Set());
  const [linesOn,      setLinesOn]      = useState(true);
  const [plantsOn,     setPlantsOn]     = useState(true);
  const [subsOn,       setSubsOn]       = useState(false);
  const [minMw,        setMinMw]        = useState(100);
  const [circleScale,  setCircleScale]  = useState(1.0);
  const [plantSource,        setPlantSource]        = useState('gem');
  const [selFeature,         setSelFeature]         = useState(null);
  const [gppdAvailable,      setGppdAvailable]      = useState(null);
  const [gemAvailable,       setGemAvailable]       = useState(null);
  const [capacity,           setCapacity]           = useState(null);
  const [fleetAge,           setFleetAge]           = useState(null);
  const [tariffs,            setTariffs]            = useState(null);
  const [access,             setAccess]             = useState(null);
  const [filteredPlantsData, setFilteredPlantsData] = useState(null);
  const [filteredLinesData,  setFilteredLinesData]  = useState(null);
  const [countryCenter,      setCountryCenter]      = useState(null);
  const [countryReady,       setCountryReady]       = useState(false);
  const [activeTab,          setActiveTab]          = useState('overview');
  const [panelWidth,         setPanelWidth]         = useState(380);
  const isDrRef   = useRef(false);
  const drStartX  = useRef(0);
  const drStartW  = useRef(0);
  const [basemap,            setBasemap]            = useState('minimal');
  const [satLabels,          setSatLabels]          = useState(false);
  const [loadCentersOn,      setLoadCentersOn]      = useState(true);
  const [lcMinPop,           setLcMinPop]           = useState(300_000);
  const [lcCircleScale,      setLcCircleScale]      = useState(1.0);
  const [zoneMode,           setZoneMode]           = useState('plain');
  const [nZones,             setNZones]             = useState(null);
  const [zonesIndex,         setZonesIndex]         = useState(null);
  const [zoneLabelsOn,       setZoneLabelsOn]       = useState(true);
  const [zoneCorridorsOn,    setZoneCorridorsOn]    = useState(false);
  const [hasNote,    setHasNote]    = useState(null);
  const [noteOpen,   setNoteOpen]   = useState(false);
  const mapReadyRef        = useRef(false);
  const countryFeatureRef  = useRef(null);
  const [isMobile,        setIsMobile]        = useState(() => window.innerWidth < 700);
  const [layerPanelOpen,  setLayerPanelOpen]  = useState(false);
  const [panelExpanded,   setPanelExpanded]   = useState(false);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 700);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    setTimeout(() => mapRef.current?.resize(), 260);
  }, [panelExpanded, isMobile]);

  // Static data — fetch once
  useEffect(() => {
    fetch('/data/tariffs.json').then(r => r.json()).then(setTariffs).catch(() => {});
    fetch('/data/access.json').then(r => r.json()).then(setAccess).catch(() => {});
    fetch('/data/zones/index.json').then(r => r.json()).then(setZonesIndex).catch(() => setZonesIndex({}));
  }, []);

  useEffect(() => {
    fetch('/data/regions.json').then(r => r.json()).then(d => {
      for (const region of (d.regions || [])) {
        const country = region.countries.find(c => c.iso === iso);
        if (country) {
          setInfo({ country, region });
          // Check GPPD and GEM availability for this region
          fetch(`/data/cache/region_plants_${region.id}_gppd.geojson`, { method: 'HEAD' })
            .then(r => setGppdAvailable(r.ok))
            .catch(() => setGppdAvailable(false));
          fetch(`/data/cache/region_plants_${region.id}_gem.geojson`, { method: 'HEAD' })
            .then(r => setGemAvailable(r.ok))
            .catch(() => setGemAvailable(false));
          fetch(`/data/notes/${iso}.html`, { method: 'HEAD' })
            .then(r => setHasNote(r.ok))
            .catch(() => setHasNote(false));
          return;
        }
      }
    });
    setFuelsOff(new Set()); setStatusOff(new Set()); setKvsOff(new Set());
    setLinesOn(true); setPlantsOn(true); setSubsOn(false); setMinMw(100); setCircleScale(1.0);
    setLcCircleScale(1.0);
    setPlantSource('gem'); setGppdAvailable(null); setGemAvailable(null); setCountryCenter(null);
    setZoneMode('plain'); setNZones(null); setZoneLabelsOn(true);
    setHasNote(null); setNoteOpen(false); setCountryReady(false);
    mapReadyRef.current = false;
    countryFeatureRef.current = null;
    track('country_view', { iso });
  }, [iso]);

  useEffect(() => {
    if (!containerRef.current || !info) return;
    const { region } = info;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(theme),
      center: [0, 20], zoom: 2,
      minZoom: 1, maxZoom: 16,
      attributionControl: false,
    });
    mapRef.current = map;

    const popup = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, offset: 10,
      className: `popup-${theme}`,
    });

    map.on('load', async () => {
      const [countries, plantsGJ, linesGJ, subsGJ, lcGJ, admin1GJ] = await Promise.all([
        fetch('/data/countries_10m.geojson').then(r => r.json()),
        fetch(`/data/cache/region_plants_${region.id}.geojson`).then(r => r.json()),
        fetch(`/data/cache/region_lines_${region.id}.geojson`).then(r => r.json()),
        fetch(`/data/cache/region_substations_${region.id}.geojson`).then(r => r.json()).catch(() => ({ type: 'FeatureCollection', features: [] })),
        fetch(`/data/region_load_centers_${region.id}.geojson`).then(r => r.json()).catch(() => ({ type: 'FeatureCollection', features: [] })),
        fetch(`/data/cache/region_admin1_${region.id}.geojson`).then(r => r.ok ? r.json() : { type: 'FeatureCollection', features: [] }).catch(() => ({ type: 'FeatureCollection', features: [] })),
      ]);

      countries.features.forEach((f, i) => {
        const p = f.properties;
        let code = p.ISO_A3 || '-99';
        if (code === '-99') code = p.ISO_A3_EH || '-99';
        if (code === '-99') code = p.ADM0_A3 || '-99';
        p.ISO_A3 = code;
        f.id = i;
      });

      const bounds = fitBoundsCountry(iso, countries);
      if (bounds) {
        map.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 9 });
        setCountryCenter({
          lon: (bounds[0][0] + bounds[1][0]) / 2,
          lat: (bounds[0][1] + bounds[1][1]) / 2,
        });
      }

      // Filter plants strictly inside the country polygon (point-in-polygon)
      // Lines filtered by bbox (segments cross borders by nature)
      const countryFeature = countries.features.find(f => f.properties.ISO_A3 === iso);
      countryFeatureRef.current = countryFeature || null;
      setCountryReady(true);
      let filteredPlants = plantsGJ;
      let filteredLines  = linesGJ;
      let filteredSubs   = subsGJ;
      if (countryFeature) {
        filteredPlants = {
          ...plantsGJ,
          features: plantsGJ.features.filter(f =>
            pointInFeature(f.geometry.coordinates, countryFeature)
          ),
        };
        filteredLines = {
          ...linesGJ,
          features: linesGJ.features.filter(f =>
            f.geometry.coordinates.some(coord => pointInFeature(coord, countryFeature))
          ),
        };
        filteredSubs = {
          ...subsGJ,
          features: subsGJ.features.filter(f =>
            pointInFeature(f.geometry.coordinates, countryFeature)
          ),
        };
      }

      setFilteredPlantsData(filteredPlants);
      setFilteredLinesData(filteredLines);

      const filteredLc = {
        ...lcGJ,
        features: lcGJ.features.filter(f => f.properties.iso === iso),
      };

      map.addSource('countries',    { type: 'geojson', data: countries,    generateId: false });
      map.addSource('plants',       { type: 'geojson', data: filteredPlants });
      map.addSource('lines',        { type: 'geojson', data: filteredLines  });
      map.addSource('substations',  { type: 'geojson', data: filteredSubs   });
      map.addSource('load-centers', { type: 'geojson', data: filteredLc     });
      map.addSource('admin1',       { type: 'geojson', data: admin1GJ       });
      const hlFilter = ['==', ['get', 'ISO_A3'], iso];
      map.addSource('zone-fills',        { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('zone-inner',        { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('zone-lines',        { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('zone-corridors-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('zone-centroids-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      const tv = getT(theme);

      map.addLayer({ id: 'land',    type: 'fill', source: 'countries',
        paint: { 'fill-color': tv.land, 'fill-opacity': 1 } });
      map.addLayer({ id: 'borders', type: 'line', source: 'countries',
        paint: { 'line-color': tv.worldBdr, 'line-width': tv.worldBdrW } });

      // Transmission lines
      const kvFilters = {
        '500': ['>=', ['get', 'v'], 500_000],
        '330': ['all', ['>=', ['get', 'v'], 330_000], ['<', ['get', 'v'], 500_000]],
        '220': ['all', ['>=', ['get', 'v'], 220_000], ['<', ['get', 'v'], 330_000]],
        '110': ['<', ['get', 'v'], 220_000],
      };
      for (const { colors, width, key } of VOLTAGE_BRACKETS) {
        map.addLayer({
          id: `lines-${key}`,
          type: 'line',
          source: 'lines',
          filter: kvFilters[key],
          paint: {
            'line-color': colors[theme] ?? colors.fog, 'line-width': width,
            'line-opacity': tv.isDark ? 0.92 : 0.65,
          },
        });
      }

      // Country highlight fill (below zones)
      const hl = tv.highlight;
      map.addLayer({
        id: 'country-fill',
        type: 'fill',
        source: 'countries',
        filter: hlFilter,
        paint: { 'fill-color': hl.fill, 'fill-opacity': 0.08 },
      });

      // Admin-1 province/state boundaries (shown in 'admin' zone mode)
      map.addLayer({
        id: 'admin1-fills', type: 'fill', source: 'admin1',
        filter: ['==', ['get', 'ISO_A3'], iso],
        layout: { visibility: 'visible' },
        paint: { 'fill-color': '#7799bb', 'fill-opacity': 0.06 },
      });
      map.addLayer({
        id: 'admin1-borders', type: 'line', source: 'admin1',
        filter: ['==', ['get', 'ISO_A3'], iso],
        layout: { visibility: 'visible' },
        paint: { 'line-color': '#5577aa', 'line-width': 0.7, 'line-opacity': 0.35 },
      });

      // Plants
      const fuels = new Set();
      for (const f of plantsGJ.features) {
        const fuel = f.properties.fuel;
        if (fuel && FUEL_COLORS[fuel]) fuels.add(fuel);
      }
      setPresentFuels(fuels);

      for (const [fuel, color] of Object.entries(FUEL_COLORS)) {
        if (!fuels.has(fuel)) continue;
        map.addLayer({
          id: `plants-${fuel}`,
          type: 'circle',
          source: 'plants',
          filter: ['all',
            ['==',  ['get', 'fuel'], fuel],
            ['>=', ['get', 'mw'],   100],
          ],
          paint: {
            'circle-radius':  plantRadiusExpr(),
            'circle-color':   color,
            'circle-opacity': 0.90,
            'circle-stroke-width': 0.6,
            'circle-stroke-color': 'rgba(0,0,0,0.3)',
          },
        });

        map.on('mouseenter', `plants-${fuel}`, e => {
          map.getCanvas().style.cursor = 'pointer';
          const p = e.features[0].properties;
          const name = p.name ? `<b>${p.name}</b><br>` : '';
          popup
            .setLngLat(e.features[0].geometry.coordinates)
            .setHTML(`${name}<span style="opacity:.75">${fuel} · ${p.mw} MW</span>`)
            .addTo(map);
        });
        map.on('mouseleave', `plants-${fuel}`, () => {
          map.getCanvas().style.cursor = ''; popup.remove();
        });
      }

      // ── Substations (tiny dimgrey squares via custom image) ──────────────────
      const sqSz = 5;
      const sqData = new Uint8Array(sqSz * sqSz * 4);
      for (let i = 0; i < sqSz * sqSz; i++) {
        sqData[i * 4] = 105; sqData[i * 4 + 1] = 105; sqData[i * 4 + 2] = 105;
        sqData[i * 4 + 3] = tv.isDark ? 160 : 130;
      }
      map.addImage('sub-sq', { width: sqSz, height: sqSz, data: sqData });
      map.addLayer({
        id: 'substations', type: 'symbol', source: 'substations',
        layout: { 'icon-image': 'sub-sq', 'icon-allow-overlap': true, 'icon-ignore-placement': true, visibility: 'none' },
        paint: { 'icon-opacity': 0.8 },
      });
      map.on('mouseenter', 'substations', e => {
        map.getCanvas().style.cursor = 'pointer';
        const p = e.features[0].properties;
        const name = p.name ? `<b>${p.name}</b><br>` : '';
        const kv = p.v ? `${Math.round(p.v / 1000)} kV` : '';
        popup.setLngLat(e.features[0].geometry.coordinates).setHTML(`${name}<span style="opacity:.75">Substation${kv ? ' · ' + kv : ''}</span>`).addTo(map);
      });
      map.on('mouseleave', 'substations', () => { map.getCanvas().style.cursor = ''; popup.remove(); });

      // ── Feature click → detail card ──────────────────────────────────────
      let clickedPoint = false;

      for (const fuel of Object.keys(FUEL_COLORS)) {
        map.on('click', `plants-${fuel}`, e => {
          clickedPoint = true;
          const p = e.features[0].properties;
          setSelFeature({ type: 'plant', props: { ...p, fuel } });
        });
      }
      map.on('click', 'substations', e => {
        clickedPoint = true;
        setSelFeature({ type: 'substation', props: e.features[0].properties });
      });
      const LINE_LAYERS = VOLTAGE_BRACKETS.map(b => `lines-${b.key}`);

      // Line hover → popup with exact voltage + endpoint substation names
      const nearestSubName = (coord) => {
        try {
          const feats = map.querySourceFeatures('substations');
          let best = null, bestD = Infinity;
          for (const f of feats) {
            if (f.geometry?.type !== 'Point') continue;
            const [lng, lat] = f.geometry.coordinates;
            const d = (lng - coord[0]) ** 2 + (lat - coord[1]) ** 2;
            if (d < bestD) { bestD = d; best = f; }
          }
          return bestD < 0.01 ? (best?.properties?.name || null) : null;
        } catch { return null; }
      };
      for (const { key } of VOLTAGE_BRACKETS) {
        map.on('mouseenter', `lines-${key}`, e => {
          map.getCanvas().style.cursor = 'pointer';
          const feat = e.features[0];
          const v = feat.properties.v;
          const geom = feat.geometry;
          const coords = geom.type === 'LineString' ? geom.coordinates : geom.coordinates.flat();
          const fromName = nearestSubName(coords[0]);
          const toName   = nearestSubName(coords[coords.length - 1]);
          const route = (fromName || toName)
            ? `<b>${[fromName, toName].filter(Boolean).join(' — ')}</b><br>` : '';
          popup.setLngLat(e.lngLat)
            .setHTML(`${route}<span style="opacity:.75">${Math.round(v / 1000)} kV</span>`)
            .addTo(map);
        });
        map.on('mousemove', `lines-${key}`, e => { popup.setLngLat(e.lngLat); });
        map.on('mouseleave', `lines-${key}`, () => { map.getCanvas().style.cursor = ''; popup.remove(); });
      }

      map.on('click', e => {
        if (clickedPoint) { clickedPoint = false; return; }
        clickedPoint = false;
        const { x, y } = e.point;
        const bbox = [[x - 8, y - 8], [x + 8, y + 8]];
        const active = LINE_LAYERS.filter(id => { try { return !!map.getLayer(id); } catch { return false; } });
        const lineFeats = active.length ? map.queryRenderedFeatures(bbox, { layers: active }) : [];
        if (lineFeats.length > 0) {
          const v = lineFeats[0].properties.v;
          const bracket = VOLTAGE_BRACKETS.find(b =>
            b.key === '500' ? v >= 500_000 : b.key === '330' ? v >= 330_000 && v < 500_000
            : b.key === '220' ? v >= 220_000 && v < 330_000 : v < 220_000
          );
          const geom = lineFeats[0].geometry;
          const coords = geom.type === 'LineString' ? geom.coordinates : geom.coordinates.flat();
          setSelFeature({ type: 'line', props: { v, voltageLabel: bracket?.label || `${Math.round(v / 1000)} kV` }, km: lineKm(coords) });
        } else {
          setSelFeature(null);
        }
      });

      // ── Zone overlay (fill + border + labels + interzone lines) ──────────────
      map.addLayer({
        id: 'zone-fills', type: 'fill', source: 'zone-fills',
        layout: { visibility: 'none' },
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
      });
      map.addLayer({
        id: 'zone-borders', type: 'line', source: 'zone-inner',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#333', 'line-width': 1.8, 'line-opacity': 0.7 },
      });
      map.addLayer({
        id: 'zone-labels', type: 'symbol', source: 'zone-fills',
        layout: {
          visibility: 'none',
          'text-field': ['get', 'zone_name'],
          'text-size': 11,
          'text-anchor': 'center',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#111',
          'text-halo-color': 'rgba(255,255,255,0.9)',
          'text-halo-width': 2,
        },
      });
      map.addLayer({
        id: 'zone-links', type: 'line', source: 'zone-lines',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#444', 'line-width': 2.5, 'line-opacity': 0.6, 'line-dasharray': [5, 4] },
      });

      // Corridor capacity lines (existing only — no planned)
      const mwWidthExpr = ['interpolate', ['linear'], ['get', 'mw'], 0, 1.5, 500, 3.0, 2000, 6.0];
      map.addLayer({
        id: 'zone-corridors-ex', type: 'line', source: 'zone-corridors-src',
        filter: ['!', ['in', ['get', 'status'], ['literal', ['planned', 'candidate', 'long_term']]]],
        layout: { visibility: 'none' },
        paint: { 'line-color': '#1a5fa8', 'line-width': mwWidthExpr, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: 'zone-corridors-labels', type: 'symbol', source: 'zone-corridors-src',
        filter: ['!', ['in', ['get', 'status'], ['literal', ['planned', 'candidate', 'long_term']]]],
        layout: {
          visibility: 'none',
          'text-field': ['get', 'label'],
          'text-size': 9,
          'symbol-placement': 'line-center',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#1a5fa8',
          'text-halo-color': 'rgba(255,255,255,0.9)',
          'text-halo-width': 1.5,
        },
      });
      map.addLayer({
        id: 'zone-corridors-dots', type: 'circle', source: 'zone-centroids-src',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 4, 'circle-color': '#696969',
          'circle-opacity': 0.75,
          'circle-stroke-width': 1.2, 'circle-stroke-color': 'rgba(255,255,255,0.7)',
        },
      });

      // Country border on top of zone layers so it always covers zone outer edges
      map.addLayer({
        id: 'country-border',
        type: 'line',
        source: 'countries',
        filter: hlFilter,
        paint: { 'line-color': hl.border, 'line-width': hl.borderW + 0.4, 'line-opacity': 0.95 },
      });

      // ── Load centers ─────────────────────────────────────────────────────────
      map.addLayer({
        id: 'load-centers', type: 'circle', source: 'load-centers',
        filter: ['>=', ['get', 'pop'], 300_000],
        paint: {
          'circle-radius': lcRadiusExpr(),
          'circle-color': '#1a237e',
          'circle-opacity': 0.72,
          'circle-stroke-width': 1.2,
          'circle-stroke-color': 'rgba(255,255,255,0.65)',
        },
      });
      map.addLayer({
        id: 'load-centers-labels', type: 'symbol', source: 'load-centers',
        filter: ['>=', ['get', 'pop'], 300_000],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 9,
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#1a237e',
          'text-halo-color': 'rgba(255,255,255,0.88)',
          'text-halo-width': 1.5,
        },
      });
      map.on('mouseenter', 'load-centers', e => {
        map.getCanvas().style.cursor = 'pointer';
        const p = e.features[0].properties;
        const pop = p.pop >= 1_000_000
          ? `${(p.pop / 1_000_000).toFixed(1)}M`
          : `${Math.round(p.pop / 1_000)}k`;
        popup.setLngLat(e.features[0].geometry.coordinates).setHTML(`<b>${p.name}</b><br><span style="opacity:.75">${pop} pop.</span>`).addTo(map);
      });
      map.on('mouseleave', 'load-centers', () => { map.getCanvas().style.cursor = ''; popup.remove(); });

      mapReadyRef.current = true;

    });

    return () => { mapReadyRef.current = false; popup.remove(); mapRef.current?.remove(); };
  }, [info, theme]);

  // ── Basemap switcher ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    swapBasemap(map, basemap, theme);
    if (basemap !== 'satellite') toggleSatLabels(map, false, theme);
  }, [basemap, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemap !== 'satellite') return;
    toggleSatLabels(map, satLabels, theme);
  }, [satLabels, basemap, theme]);

  // ── Layer toggle handlers ────────────────────────────────────────────────

  const toggleFuel = useCallback(fuel => {
    const map = mapRef.current;
    if (!map || !map.getLayer(`plants-${fuel}`)) return;
    setFuelsOff(prev => {
      const next = new Set(prev);
      if (next.has(fuel)) { next.delete(fuel); map.setLayoutProperty(`plants-${fuel}`, 'visibility', 'visible'); }
      else                { next.add(fuel);    map.setLayoutProperty(`plants-${fuel}`, 'visibility', 'none');    }
      return next;
    });
  }, []);

  const toggleKv = useCallback(key => {
    const map = mapRef.current;
    if (!map || !map.getLayer(`lines-${key}`)) return;
    setKvsOff(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); map.setLayoutProperty(`lines-${key}`, 'visibility', 'visible'); }
      else               { next.add(key);    map.setLayoutProperty(`lines-${key}`, 'visibility', 'none');    }
      return next;
    });
  }, []);

  const toggleLines = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setLinesOn(prev => {
      const next = !prev;
      for (const { key } of VOLTAGE_BRACKETS)
        if (!kvsOff.has(key) && map.getLayer(`lines-${key}`))
          map.setLayoutProperty(`lines-${key}`, 'visibility', next ? 'visible' : 'none');
      return next;
    });
  }, [kvsOff]);

  const togglePlants = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setPlantsOn(prev => {
      const next = !prev;
      for (const fuel of presentFuels)
        if (!fuelsOff.has(fuel) && map.getLayer(`plants-${fuel}`))
          map.setLayoutProperty(`plants-${fuel}`, 'visibility', next ? 'visible' : 'none');
      return next;
    });
  }, [presentFuels, fuelsOff]);

  const toggleSubs = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('substations')) return;
    setSubsOn(prev => {
      const next = !prev;
      map.setLayoutProperty('substations', 'visibility', next ? 'visible' : 'none');
      return next;
    });
  }, []);

  const toggleStatus = useCallback(status => {
    const map = mapRef.current;
    if (!map) return;
    setStatusOff(prev => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      for (const fuel of Object.keys(FUEL_COLORS)) {
        if (!map.getLayer(`plants-${fuel}`)) continue;
        map.setFilter(`plants-${fuel}`, buildPlantFilter(fuel, minMw, next));
      }
      return next;
    });
  }, [minMw]);

  const toggleLoadCenters = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setLoadCentersOn(prev => {
      const next = !prev;
      for (const id of ['load-centers', 'load-centers-labels']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', next ? 'visible' : 'none');
      }
      return next;
    });
  }, []);

  const toggleZoneLabels = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('zone-labels')) return;
    setZoneLabelsOn(prev => {
      const next = !prev;
      map.setLayoutProperty('zone-labels', 'visibility', next ? 'visible' : 'none');
      return next;
    });
  }, []);

  const toggleZoneCorridors = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setZoneCorridorsOn(prev => {
      const next = !prev;
      for (const id of ['zone-corridors-ex', 'zone-corridors-labels', 'zone-corridors-dots']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', next ? 'visible' : 'none');
      }
      return next;
    });
  }, []);

  const handleLcMinPop = useCallback(pop => {
    const map = mapRef.current;
    if (!map) return;
    setLcMinPop(pop);
    for (const id of ['load-centers', 'load-centers-labels']) {
      if (map.getLayer(id)) map.setFilter(id, ['>=', ['get', 'pop'], pop]);
    }
  }, []);

  const handleMinMw = useCallback(mw => {
    const map = mapRef.current;
    if (!map) return;
    setMinMw(mw);
    setStatusOff(prev => {
      for (const fuel of Object.keys(FUEL_COLORS)) {
        if (!map.getLayer(`plants-${fuel}`)) continue;
        map.setFilter(`plants-${fuel}`, buildPlantFilter(fuel, mw, prev));
      }
      return prev;
    });
  }, []);

  const handleCircleScale = useCallback(scale => {
    const map = mapRef.current;
    if (!map) return;
    setCircleScale(scale);
    for (const fuel of Object.keys(FUEL_COLORS)) {
      if (!map.getLayer(`plants-${fuel}`)) continue;
      map.setPaintProperty(`plants-${fuel}`, 'circle-radius', plantRadiusExpr(scale));
    }
  }, []);

  const handleLcCircleScale = useCallback(scale => {
    const map = mapRef.current;
    if (!map) return;
    setLcCircleScale(scale);
    if (map.getLayer('load-centers')) {
      map.setPaintProperty('load-centers', 'circle-radius', lcRadiusExpr(scale));
    }
  }, []);

  // ── Zone overlay ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current || !map.getSource('zone-fills')) return;
    const ZONE_IDS  = ['zone-fills', 'zone-borders'];
    const ADMIN_IDS = ['admin1-fills', 'admin1-borders'];

    const showAdmin = zoneMode === 'admin';
    for (const id of ADMIN_IDS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showAdmin ? 'visible' : 'none');
    }

    if (zoneMode !== 'modeling' || !nZones) {
      for (const id of ZONE_IDS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      }
      for (const id of ['zone-corridors-ex', 'zone-corridors-labels', 'zone-corridors-dots']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      }
      return;
    }

    const COLORS = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'];
    const label = `${iso}_${nZones}z`;

    Promise.all([
      fetch(`/data/zones/${label}_zones.geojson`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/data/zones/${label}_topo.json`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`/data/zones/${label}_inner.geojson`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/data/zones/${label}_corridors.geojson`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([zonesGJ, topo, innerGJ, corridorsGJ]) => {
      if (!zonesGJ || !map.getSource('zone-fills')) return;
      zonesGJ.features.forEach((f, i) => { f.properties.color = COLORS[i % COLORS.length]; });
      map.getSource('zone-fills').setData(zonesGJ);
      if (innerGJ && map.getSource('zone-inner')) map.getSource('zone-inner').setData(innerGJ);

      // Build interzone line geometries from centroids
      const centroids = {};
      for (const f of zonesGJ.features) {
        const name = f.properties.zone_name;
        const coords = f.geometry.type === 'Polygon'
          ? f.geometry.coordinates[0]
          : f.geometry.coordinates[0][0];
        centroids[name] = [
          coords.reduce((s, p) => s + p[0], 0) / coords.length,
          coords.reduce((s, p) => s + p[1], 0) / coords.length,
        ];
      }
      const lineFeatures = topo
        .filter(l => centroids[l.z] && centroids[l.zz])
        .map(l => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [centroids[l.z], centroids[l.zz]] },
          properties: l,
        }));
      map.getSource('zone-lines').setData({ type: 'FeatureCollection', features: lineFeatures });

      // Corridor capacity overlay — always update source (clear if no file for this zone count)
      const emptyGJ = { type: 'FeatureCollection', features: [] };
      if (map.getSource('zone-corridors-src'))
        map.getSource('zone-corridors-src').setData(corridorsGJ || emptyGJ);
      // Extract unique zone centroids from corridor endpoints
      const centroidMap = new Map();
      for (const f of (corridorsGJ?.features || [])) {
        const [s, e] = [f.geometry.coordinates[0], f.geometry.coordinates[f.geometry.coordinates.length - 1]];
        const ks = `${s[0]},${s[1]}`;
        const ke = `${e[0]},${e[1]}`;
        if (!centroidMap.has(ks)) centroidMap.set(ks, { type: 'Feature', geometry: { type: 'Point', coordinates: s }, properties: { zone: f.properties.zone_a } });
        if (!centroidMap.has(ke)) centroidMap.set(ke, { type: 'Feature', geometry: { type: 'Point', coordinates: e }, properties: { zone: f.properties.zone_b } });
      }
      if (map.getSource('zone-centroids-src'))
        map.getSource('zone-centroids-src').setData({ type: 'FeatureCollection', features: [...centroidMap.values()] });
      for (const id of ['zone-corridors-ex', 'zone-corridors-labels', 'zone-corridors-dots']) {
        if (map.getLayer(id))
          map.setLayoutProperty(id, 'visibility', zoneCorridorsOn ? 'visible' : 'none');
      }

      for (const id of ZONE_IDS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
      }
      if (map.getLayer('zone-labels'))
        map.setLayoutProperty('zone-labels', 'visibility', zoneLabelsOn ? 'visible' : 'none');
    });
  }, [zoneMode, nZones, iso, zoneLabelsOn, zoneCorridorsOn]);

  // ── Plant source hot-swap ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource('plants') || !info || !countryReady) return;
    const suffix = plantSource === 'gppd' ? '_gppd' : plantSource === 'gem' ? '_gem' : '';
    const filename = `region_plants_${info.region.id}${suffix}.geojson`;
    fetch(`/data/cache/${filename}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        const cf = countryFeatureRef.current;
        const filtered = {
          ...data,
          features: data.features.filter(f => pointInFeature(f.geometry.coordinates, cf)),
        };
        map.getSource('plants').setData(filtered);
        setFilteredPlantsData(filtered);
        const fuels = new Set(filtered.features.map(f => f.properties.fuel).filter(f => FUEL_COLORS[f]));
        setPresentFuels(fuels);
      })
      .catch(() => {
        if (plantSource === 'gppd') { setGppdAvailable(false); setPlantSource('osm'); }
        if (plantSource === 'gem')  { setGemAvailable(false);  setPlantSource('osm'); }
      });
  }, [plantSource, info, countryReady]);

  // Capacity summary for right panel
  useEffect(() => {
    if (!info) return;
    setCapacity(null);
    const capSuffix = plantSource === 'gppd' ? '_gppd' : plantSource === 'gem' ? '_gem' : '';
    const cf = `/data/cache/region_capacity_${info.region.id}${capSuffix}.json`;
    fetch(cf).then(r => r.json()).then(setCapacity).catch(() => {});
  }, [info, plantSource]);

  // Fleet age — GPPD only
  useEffect(() => {
    setFleetAge(null);
    if (!info || plantSource !== 'gppd') return;
    fetch(`/data/cache/region_age_${info.region.id}_gppd.json`)
      .then(r => r.ok ? r.json() : null)
      .then(setFleetAge)
      .catch(() => setFleetAge(null));
  }, [plantSource, info]);


  // ── Briefing note: close on Esc ──────────────────────────────────────────
  useEffect(() => {
    if (!noteOpen) return;
    const onKey = e => { if (e.key === 'Escape') setNoteOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [noteOpen]);

  // ── Download handlers ────────────────────────────────────────────────────

  const handleDownloadPlants = useCallback((format = 'geojson') => {
    if (!filteredPlantsData) return;
    track('data_download', { type: 'plants', format, source: plantSource, iso });
    const suffix = plantSource === 'gppd' ? '_gppd' : plantSource === 'gem' ? '_gem' : '';
    if (format === 'csv') {
      const header = 'name,fuel,mw,country,status,lat,lon,source';
      const rows = filteredPlantsData.features.map(f => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        return [
          `"${(p.name || '').replace(/"/g, '""')}"`,
          p.fuel || '', p.mw || '', p.country || '',
          p.status || 'operating', lat.toFixed(5), lon.toFixed(5),
          plantSource,
        ].join(',');
      });
      downloadBlob([header, ...rows].join('\n'), `plants_${iso}${suffix}.csv`, 'text/csv');
    } else {
      downloadBlob(JSON.stringify(filteredPlantsData), `plants_${iso}.geojson`, 'application/geo+json');
    }
  }, [filteredPlantsData, iso, plantSource]);

  const handleDownloadLines = useCallback((format = 'geojson') => {
    if (!filteredLinesData) return;
    track('data_download', { type: 'lines', format, iso });
    if (format === 'csv') {
      const header = 'id,voltage_kv,geometry_wkt';
      const rows = filteredLinesData.features.map((f, i) => {
        const vkv = f.properties.v ? Math.round(f.properties.v / 1000) : '';
        const wkt = `LINESTRING(${f.geometry.coordinates.map(([x, y]) => `${x} ${y}`).join(', ')})`;
        return `${i},${vkv},"${wkt}"`;
      });
      downloadBlob([header, ...rows].join('\n'), `lines_${iso}.csv`, 'text/csv');
    } else {
      downloadBlob(JSON.stringify(filteredLinesData), `lines_${iso}.geojson`, 'application/geo+json');
    }
  }, [filteredLinesData, iso]);

  if (!info) return <div style={{ padding: 40, color: t.text }}>Loading…</div>;

  const { country, region } = info;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 46px)', position: 'relative' }}
      onMouseMove={e => { if (!isDrRef.current) return; setPanelWidth(w => Math.max(220, Math.min(520, drStartW.current + (drStartX.current - e.clientX)))); }}
      onMouseUp={() => { isDrRef.current = false; }}
      onMouseLeave={() => { isDrRef.current = false; }}
    >
      {isMobile && layerPanelOpen && (
        <div onClick={() => setLayerPanelOpen(false)} style={{
          position: 'absolute', inset: 0, zIndex: 299, backgroundColor: 'rgba(0,0,0,0.35)',
        }} />
      )}
      <div style={isMobile ? {
        position: 'absolute', top: 0, left: 0, zIndex: 300, height: '100%',
        boxShadow: '2px 0 16px rgba(0,0,0,0.3)',
        display: layerPanelOpen ? 'block' : 'none',
      } : {}}>
        <LayerPanel
        theme={theme}
        fuelsOff={fuelsOff} statusOff={statusOff} kvsOff={kvsOff}
        linesOn={linesOn} plantsOn={plantsOn} subsOn={subsOn}
        minMw={minMw} circleScale={circleScale}
        plantSource={plantSource} gppdAvailable={gppdAvailable} gemAvailable={gemAvailable}
        presentFuels={presentFuels}
        basemap={basemap} onBasemap={setBasemap} satLabels={satLabels} onSatLabels={setSatLabels}
        onToggleFuel={toggleFuel} onToggleStatus={toggleStatus} onToggleKv={toggleKv}
        onToggleLines={toggleLines} onTogglePlants={togglePlants}
        onToggleSubs={toggleSubs}
        loadCentersOn={loadCentersOn} lcMinPop={lcMinPop} lcCircleScale={lcCircleScale}
        onToggleLoadCenters={toggleLoadCenters} onLcMinPopChange={handleLcMinPop}
        onLcCircleScaleChange={handleLcCircleScale}
        onMinMwChange={handleMinMw} onCircleScaleChange={handleCircleScale}
        onSourceChange={s => { setPlantSource(s); track('plant_source_change', { source: s, iso }); }}
        onDownloadPlants={handleDownloadPlants}
        onDownloadLines={handleDownloadLines}
      />
      </div>

      <div style={{ flex: 1, position: 'relative', height: 'calc(100vh - 46px)' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0, backgroundColor: t.bg }} />
        {isMobile && (
          <button onClick={() => setLayerPanelOpen(o => !o)} style={{
            position: 'absolute', top: 10, left: 12, zIndex: 200,
            width: 36, height: 36, borderRadius: 8,
            backgroundColor: t.panel, border: `1px solid ${t.panelBorder}`,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,.25)', color: t.lbl,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
          </button>
        )}

        {/* ── Floating zone selector ── */}
        {zonesIndex !== null && (
          <div style={{
            position: 'absolute', top: 10, right: 10, zIndex: 10,
            backgroundColor: t.panel, border: `1px solid ${t.panelBorder}`,
            borderRadius: 6, padding: '8px 10px', minWidth: 130,
            boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
          }}>
            <span style={{
              fontSize: '0.44rem', letterSpacing: '2px', fontWeight: 700,
              color: t.lblMuted, textTransform: 'uppercase', display: 'block', marginBottom: 6,
            }}>Zones</span>
            <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
              {[['plain', 'Plain'], ['admin', 'Admin'], ['modeling', 'Clustering']].map(([mode, label]) => {
                const active = zoneMode === mode;
                const disabled = mode === 'modeling' && !(zonesIndex[iso]?.length);
                return (
                  <button key={mode} disabled={disabled}
                    onClick={() => {
                      setZoneMode(mode);
                      if (mode === 'modeling' && !nZones && zonesIndex[iso]?.length) {
                        setNZones(zonesIndex[iso][0]);
                      }
                    }}
                    style={{
                      flex: 1, fontSize: '0.5rem', padding: '3px 0',
                      borderRadius: 3, cursor: disabled ? 'default' : 'pointer',
                      fontFamily: 'inherit', letterSpacing: '0.5px',
                      border: `1px solid ${active ? 'rgba(74,143,204,0.65)' : t.panelBorder}`,
                      backgroundColor: active ? 'rgba(74,143,204,0.13)' : 'transparent',
                      color: active ? t.lbl : t.lblMuted,
                      opacity: disabled ? 0.4 : 1,
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>

            {zoneMode === 'modeling' && zonesIndex[iso]?.length ? (
              <>
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {zonesIndex[iso].map(n => (
                    <button key={n} onClick={() => setNZones(n)} style={{
                      fontSize: '0.48rem', padding: '2px 6px',
                      borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${nZones === n ? 'rgba(74,143,204,0.65)' : t.panelBorder}`,
                      backgroundColor: nZones === n ? 'rgba(74,143,204,0.13)' : 'transparent',
                      color: nZones === n ? t.lbl : t.lblMuted,
                    }}>
                      {n}z
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 5, borderTop: `1px solid ${t.panelBorder}`, paddingTop: 4, display: 'flex', gap: 3 }}>
                  <button onClick={toggleZoneLabels} style={{
                    fontSize: '0.48rem', padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'inherit', flex: 1,
                    border: `1px solid ${zoneLabelsOn ? 'rgba(74,143,204,0.65)' : t.panelBorder}`,
                    backgroundColor: zoneLabelsOn ? 'rgba(74,143,204,0.13)' : 'transparent',
                    color: zoneLabelsOn ? t.lbl : t.lblMuted,
                  }}>
                    Labels
                  </button>
                  <button onClick={toggleZoneCorridors} style={{
                    fontSize: '0.48rem', padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'inherit', flex: 1,
                    border: `1px solid ${zoneCorridorsOn ? 'rgba(74,143,204,0.65)' : t.panelBorder}`,
                    backgroundColor: zoneCorridorsOn ? 'rgba(74,143,204,0.13)' : 'transparent',
                    color: zoneCorridorsOn ? t.lbl : t.lblMuted,
                  }}>
                    Corridors
                  </button>
                </div>
              </>
            ) : zoneMode === 'modeling' ? (
              <p style={{ fontSize: '0.48rem', color: t.lblMuted, fontStyle: 'italic', margin: 0 }}>
                No zone data — run pipeline
              </p>
            ) : null}
          </div>
        )}

        {/* Feature detail card */}
        {selFeature && (
          <div style={{
            position: 'absolute', bottom: 24, left: 16, zIndex: 20,
            backgroundColor: t.panel, border: `1px solid ${t.panelBorder}`,
            borderRadius: 8, padding: '10px 14px', minWidth: 180, maxWidth: 260,
            boxShadow: '0 2px 12px rgba(0,0,0,.22)',
            fontSize: '0.7rem', color: t.text,
          }}>
            <button onClick={() => setSelFeature(null)} style={{
              position: 'absolute', top: 6, right: 8,
              background: 'none', border: 'none', cursor: 'pointer',
              color: t.lblMuted, fontSize: '0.9rem', lineHeight: 1, padding: 0,
            }}>✕</button>

            {selFeature.type === 'line' && (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6, color: t.lbl }}>Transmission line</div>
                <Row label="Voltage" value={selFeature.props.voltageLabel} t={t} />
                {selFeature.km > 0 && <Row label="Length" value={`~${Math.round(selFeature.km)} km`} t={t} />}
              </>
            )}

            {selFeature.type === 'plant' && (() => {
              const p = selFeature.props;
              return (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: t.lbl }}>
                    {p.name || 'Power plant'}
                  </div>
                  <Row label="Fuel" value={
                    <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                      <span style={{ width:8, height:8, borderRadius:'50%', flexShrink:0,
                        backgroundColor: FUEL_COLORS[p.fuel] || '#888' }} />
                      {p.fuel}
                    </span>
                  } t={t} />
                  {p.mw > 0 && <Row label="Capacity" value={`${p.mw} MW`} t={t} />}
                  {p.country && <Row label="Country" value={p.country} t={t} />}
                  {p.status && p.status !== 'operating' && (
                    <Row label="Status" value={p.status} t={t} />
                  )}
                </>
              );
            })()}

            {selFeature.type === 'substation' && (() => {
              const p = selFeature.props;
              return (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: t.lbl }}>
                    {p.name || 'Substation'}
                  </div>
                  {p.v > 0 && <Row label="Voltage" value={`${Math.round(p.v / 1000)} kV`} t={t} />}
                  {p.iso && <Row label="Country" value={p.iso} t={t} />}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Briefing note drawer (covers map area only) ── */}
      {noteOpen && hasNote && (
        <>
          <div
            onClick={() => setNoteOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 998,
              backgroundColor: 'rgba(0,0,0,0.38)',
            }}
          />
          <div style={{
            position: 'fixed',
            top: 46,
            left: 170,
            right: 268,
            bottom: 0,
            zIndex: 999,
            backgroundColor: '#fff',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              padding: '6px 10px',
              borderBottom: '1px solid #E2E6EA',
              backgroundColor: '#F8F9FB',
              flexShrink: 0,
            }}>
              <button
                onClick={() => setNoteOpen(false)}
                style={{
                  background: 'none', border: '1px solid #E2E6EA',
                  borderRadius: 4, padding: '3px 10px', cursor: 'pointer',
                  fontSize: '0.65rem', color: '#5A6474', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                Close (Esc)
              </button>
            </div>
            <iframe
              src={`/data/notes/${iso}.html`}
              title={`${country.name} – Sector Briefing Note`}
              style={{ flex: 1, border: 'none', width: '100%' }}
            />
          </div>
        </>
      )}

      {!isMobile && (
        <div style={{ width: 5, flexShrink: 0, cursor: 'col-resize', backgroundColor: 'transparent' }}
          onMouseDown={e => { isDrRef.current = true; drStartX.current = e.clientX; drStartW.current = panelWidth; e.preventDefault(); }} />
      )}

      {/* Right panel */}
      <div style={isMobile ? {
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        height: panelExpanded ? '50vh' : 56,
        overflow: 'hidden',
        backgroundColor: t.panel, borderTop: `1px solid ${t.panelBorder}`,
        borderRadius: '12px 12px 0 0',
        boxShadow: '0 -6px 24px rgba(0,0,0,0.35)',
        transition: 'height 0.25s ease',
      } : {
        width: panelWidth, height: 'calc(100vh - 46px)', overflowY: 'auto',
        backgroundColor: t.panel,
        borderLeft: `1px solid ${t.panelBorder}`,
        flexShrink: 0, display: 'flex', flexDirection: 'column',
      }}>
        {isMobile && (
          <div onClick={() => setPanelExpanded(e => !e)} style={{
            height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 16px', cursor: 'pointer', flexShrink: 0,
            borderBottom: panelExpanded ? `1px solid ${t.panelBorder}` : 'none',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
              width: 36, height: 5, borderRadius: 3,
              backgroundColor: t.muted, opacity: 0.55,
            }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: t.lbl }}>{country.name}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.text} strokeWidth="2.5" strokeLinecap="round">
              {panelExpanded ? <polyline points="6 9 12 15 18 9"/> : <polyline points="6 15 12 9 18 15"/>}
            </svg>
          </div>
        )}
        <div style={isMobile ? { overflowY: 'auto', height: 'calc(50vh - 56px)', padding: '12px 16px 24px' } : { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {/* ── Fixed header ── */}
        <div style={{ padding: '14px 16px 0', flexShrink: 0 }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            <Link to="/" style={{ fontSize: '0.68rem', color: t.muted }}>World</Link>
            <span style={{ color: t.panelBorder, fontSize: '0.68rem' }}>/</span>
            <Link to={`/region/${region.id}`} style={{ fontSize: '0.68rem', color: t.muted }}>{region.name}</Link>
            <span style={{ color: t.panelBorder, fontSize: '0.68rem' }}>/</span>
            <span style={{ fontSize: '0.68rem', color: t.lbl, fontWeight: 600 }}>{country.name}</span>
          </div>

          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: t.text, marginBottom: 6 }}>
            {country.name}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
              fontSize: '0.68rem', fontWeight: 600, color: 'white',
              backgroundColor: region.color, borderRadius: 4,
              padding: '2px 8px', display: 'inline-block',
            }}>
              {iso}
            </span>
            <div style={{ height: 3, width: 24, borderRadius: 2, backgroundColor: region.color }} />
          </div>

          {/* ── Tab buttons ── */}
          <div style={{ display: 'flex', gap: 3, marginBottom: 0 }}>
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'load',     label: 'Load' },
              { id: 'supply',   label: 'Supply & Trade' },
              { id: 're',       label: 'RE' },
              { id: 'zoning',   label: 'Zones' },
            ].map(({ id, label }) => {
              const active = activeTab === id;
              return (
                <button key={id} onClick={() => { setActiveTab(id); track('tab_change', { tab: id, iso }); }} style={{
                  flex: 1, fontSize: '0.48rem', letterSpacing: '0.5px',
                  textTransform: 'uppercase', fontFamily: 'inherit',
                  padding: '4px 0', borderRadius: '3px 3px 0 0',
                  cursor: 'pointer',
                  border: `1px solid ${active ? t.panelBorder : 'rgba(128,160,192,0.18)'}`,
                  borderBottom: active ? `1px solid ${t.panel}` : `1px solid ${t.panelBorder}`,
                  backgroundColor: active ? t.panel : 'transparent',
                  color: active ? t.lbl : t.lblMuted,
                  fontWeight: active ? 700 : 400,
                  position: 'relative', zIndex: active ? 2 : 1,
                }}>
                  {label}
                </button>
              );
            })}
            {hasNote && (
              <button
                onClick={() => setNoteOpen(o => !o)}
                title="Open sector briefing note"
                style={{
                  flex: 1, fontSize: '0.48rem', letterSpacing: '0.5px',
                  textTransform: 'uppercase', fontFamily: 'inherit',
                  padding: '4px 0', borderRadius: '3px 3px 0 0',
                  cursor: 'pointer',
                  border: `1px solid ${noteOpen ? t.panelBorder : 'rgba(128,160,192,0.18)'}`,
                  borderBottom: noteOpen ? `1px solid ${t.panel}` : `1px solid ${t.panelBorder}`,
                  backgroundColor: noteOpen ? t.panel : 'transparent',
                  color: noteOpen ? '#2E75B6' : t.lblMuted,
                  fontWeight: noteOpen ? 700 : 400,
                  position: 'relative', zIndex: noteOpen ? 2 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                }}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                Brief
              </button>
            )}
          </div>
          <div style={{ height: 1, backgroundColor: t.panelBorder, marginTop: -1, position: 'relative', zIndex: 0 }} />
        </div>

        {/* ── Scrollable tab content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

          {activeTab === 'overview' && (
            <>
              <CountryOverview
                iso={iso}
                region={region}
                capacity={capacity}
                fleetAge={fleetAge}
                tariffs={tariffs}
                access={access}
                theme={theme}
                source={plantSource}
              />
              {/* Export */}
              <div style={{ marginTop: 16, borderTop: `1px solid ${t.panelBorder}`, paddingTop: 12 }}>
                <span style={{ fontSize: '0.47rem', letterSpacing: '2px', fontWeight: 700, color: t.lblMuted, textTransform: 'uppercase', display: 'block', marginBottom: 7 }}>
                  Export Data
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {[
                    { label: 'Plants GeoJSON', fn: () => handleDownloadPlants('geojson') },
                    { label: 'Plants CSV',     fn: () => handleDownloadPlants('csv') },
                    { label: 'Lines GeoJSON',  fn: () => handleDownloadLines('geojson') },
                    { label: 'Lines CSV',      fn: () => handleDownloadLines('csv') },
                  ].map(({ label, fn }) => (
                    <button key={label} onClick={fn} style={{
                      background: 'none', border: `1px solid ${t.panelBorder}`,
                      borderRadius: 3, padding: '4px 6px', cursor: 'pointer',
                      fontSize: '0.52rem', color: t.muted, fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                    }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      {label}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: '0.47rem', color: t.lblMuted, marginTop: 6, fontStyle: 'italic' }}>
                  Source: {plantSource.toUpperCase()} · {country.name} only
                </p>
              </div>
            </>
          )}

          {activeTab === 'supply' && (
            <SupplyTab iso={iso} theme={theme} />
          )}

          {activeTab === 're' && (
            <REResourcesTab center={countryCenter} theme={theme} />
          )}

          {activeTab === 'load' && (
            <LoadTab iso={iso} theme={theme} />
          )}

          {activeTab === 'zoning' && (
            <ZoningTab iso={iso} theme={theme} regionId={region.id} />
          )}

          <div style={{ borderTop: `1px solid ${t.hr}`, paddingTop: 12, marginTop: 20 }}>
            <Link
              to={`/region/${region.id}`}
              style={{ fontSize: '0.72rem', color: region.color, display: 'flex', alignItems: 'center', gap: 5 }}
            >
              ← Back to {region.name}
            </Link>
          </div>
        </div>
        </div>{/* content wrapper */}
      </div>
    </div>
  );
}
