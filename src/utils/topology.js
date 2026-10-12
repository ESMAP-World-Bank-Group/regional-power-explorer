// No imports: tools/build_derived_data.mjs runs this under Node too, so the
// country files it cuts use the very geometry the pages draw.

/**
 * The FeatureCollection in one of the extract's TopoJSON files. It reads only
 * what tools/prepare_gad.py topology() writes -- quantized, delta-encoded, one
 * arc per ring, MultiPolygons -- not TopoJSON at large. Feature ids are
 * assigned here because MapLibre needs them for setFeatureState and the
 * source is loaded with generateId: false.
 */
export function fromTopology(topo) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const rings = topo.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]);
  });
  return {
    type: 'FeatureCollection',
    features: topo.objects.features.geometries.map((g, i) => ({
      type: 'Feature',
      id: i,
      properties: g.properties,
      geometry: { type: 'MultiPolygon', coordinates: polygons(g.arcs, rings) },
    })),
  };
}

// A ring needs four positions (three corners and the closing one). The source
// carries a few that do not -- one of Ghana's is a single point, and Vatican
// City, Monaco and Gibraltar are two-point slivers at world scale -- which
// MapLibre skips but d3-geo, behind the Equal Earth export, fails on. A
// polygon whose outline is unusable goes with its holes.
function polygons(arcs, rings) {
  const out = [];
  for (const poly of arcs) {
    const [outline, ...holes] = poly.map(([a]) => rings[a]).map(r => (r?.length >= 4 ? r : null));
    if (outline) out.push([outline, ...holes.filter(Boolean)]);
  }
  return out;
}
