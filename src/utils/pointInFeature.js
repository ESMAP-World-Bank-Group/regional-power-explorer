/**
 * Whether a [lon, lat] point lies inside a Polygon or MultiPolygon feature.
 *
 * A polygon's first ring is its outline and any further rings are holes: a
 * point in a hole is outside. South Africa's outline has Lesotho as a hole,
 * and testing every ring alike counted Lesotho's plants as South Africa's.
 * Points exactly on a ring are decided by the ray cast, as before.
 *
 * Each feature is prepared once, on first use, and kept for the next call:
 * bounding boxes, and every ring's edges indexed by latitude band. A ray cast
 * only ever counts edges that span the point's latitude, so testing just that
 * band gives the same answer as testing every edge. The country page tests
 * South Asia's 80,000 line vertices against India's 24,000-point outline;
 * edge by edge that froze the page for about 7 s.
 */
export function pointInFeature(pt, feature) {
  let test = prepared.get(feature);
  if (!test) { test = prepare(feature.geometry); prepared.set(feature, test); }
  return test(pt[0], pt[1]);
}

const prepared = new WeakMap();

function prepare(g) {
  const polys = (g.type === 'Polygon' ? [g.coordinates]
    : g.type === 'MultiPolygon' ? g.coordinates : []).filter(p => p[0]?.length);
  const tests = polys.map(preparePolygon);
  if (tests.length <= 32) return (x, y) => tests.some(t => t(x, y));

  // Many polygons -- Indonesia is thousands of islands: a coarse grid over the
  // feature lists the polygons whose box touches each cell, so a point only
  // tries the few near it.
  const boxes = polys.map(([outline]) => box(outline));
  const x0 = Math.min(...boxes.map(b => b[0])), y0 = Math.min(...boxes.map(b => b[1]));
  const x1 = Math.max(...boxes.map(b => b[2])), y1 = Math.max(...boxes.map(b => b[3]));
  const G = 64, w = (x1 - x0) / G || 1, h = (y1 - y0) / G || 1;
  const cell = (v, v0, d) => Math.min(G - 1, Math.max(0, Math.floor((v - v0) / d)));
  const grid = Array.from({ length: G * G }, () => []);
  boxes.forEach(([bx0, by0, bx1, by1], k) => {
    for (let cy = cell(by0, y0, h); cy <= cell(by1, y0, h); cy++)
      for (let cx = cell(bx0, x0, w); cx <= cell(bx1, x0, w); cx++) grid[cy * G + cx].push(k);
  });
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    return grid[cell(y, y0, h) * G + cell(x, x0, w)].some(k => tests[k](x, y));
  };
}

function preparePolygon([outline, ...holes]) {
  const out = prepareRing(outline);
  const hs = holes.filter(h => h?.length).map(prepareRing);
  return (x, y) => out(x, y) && !hs.some(h => h(x, y));
}

function box(ring) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function prepareRing(ring) {
  const n = ring.length;
  const [x0, y0, x1, y1] = box(ring);
  // Outside the ring's box the ray crosses it an even number of times.
  const inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (n < 64) return (x, y) => inBox(x, y) && castAll(ring, x, y);

  const bands = Math.min(1024, Math.ceil(n / 8));
  const h = (y1 - y0) / bands || 1;
  const bandOf = y => Math.min(bands - 1, Math.max(0, Math.floor((y - y0) / h)));
  const index = Array.from({ length: bands }, () => []);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ring[i][1], yj = ring[j][1];
    if (yi === yj) continue; // never counted by the cast below
    for (let b = bandOf(Math.min(yi, yj)), e = bandOf(Math.max(yi, yj)); b <= e; b++) index[b].push(i);
  }
  return (x, y) => {
    if (!inBox(x, y)) return false;
    let inside = false;
    for (const i of index[bandOf(y)]) {
      const j = i === 0 ? n - 1 : i - 1;
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

function castAll(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
