/**
 * The app's JSON data files, fetched once and shared.
 *
 * A map is rebuilt from scratch on every theme or basemap change, and several
 * panels read the same files (regions.json, supply/<ISO>.json), so without
 * this every rebuild downloaded the region's plants and lines again -- some
 * 30 MB for Europe. Parsed files are kept up to a budget of their JSON text,
 * and the least recently used are dropped beyond it, so browsing region after
 * region does not hold every file at once.
 *
 * Callers share the parsed object: read it, never change it in place.
 */

const BUDGET = 80e6;           // characters of JSON text held, roughly bytes
const entries = new Map();     // url -> { promise, size }, oldest use first
let held = 0;

/**
 * The parsed JSON at `url`. Rejects on an HTTP error or bad JSON, and a
 * failed fetch is not kept, so the next call tries again.
 */
export function fetchData(url) {
  const hit = entries.get(url);
  if (hit) {
    entries.delete(url);       // re-insert: Map order is the recency order
    entries.set(url, hit);
    return hit.promise;
  }
  const entry = { size: 0 };
  entry.promise = fetch(url)
    .then(async r => {
      // Without this a 404 reaches the parser and fails as bad JSON on the
      // HTML the server sent instead, which says nothing about what happened.
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      const text = await r.text();
      entry.size = text.length;
      held += text.length;
      trim(url);
      return JSON.parse(text);
    })
    .catch(err => {
      if (entries.get(url) === entry) {
        entries.delete(url);
        held -= entry.size;
      }
      throw err;
    });
  entries.set(url, entry);
  return entry.promise;
}

// Drop the least recently used files until the budget holds. Downloads still
// in flight (size 0) and the file just added are never dropped.
function trim(keep) {
  for (const [url, e] of entries) {
    if (held <= BUDGET) break;
    if (url === keep || !e.size) continue;
    entries.delete(url);
    held -= e.size;
  }
}
