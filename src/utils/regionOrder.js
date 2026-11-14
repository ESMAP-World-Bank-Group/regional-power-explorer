// Display order of the regions.
//
// regions.json lists its regions in precedence order: a country that sits in
// several regions takes its world-map colour and its country page from the
// first one, so that order is for the data, not for reading. The file's
// `legend` key lays the same regions out by geography, and this turns it into
// groups of region objects for the world legend and the PNG export.
export function regionGroups(regions, legend) {
  const byId = new Map((regions || []).map(r => [r.id, r]));
  const seen = new Set();
  const groups = [];
  for (const g of legend || []) {
    const members = [];
    for (const id of g.regions || []) {
      const r = byId.get(id);
      if (r && !seen.has(id)) { seen.add(id); members.push(r); }
    }
    if (members.length) groups.push({ label: g.group, regions: members });
  }
  // A region the legend does not name still shows, after the groups, so a new
  // entry in regions.json never goes missing from the map. Sub-regions unfold
  // under their parent and are never listed on their own.
  const rest = (regions || []).filter(r => r.type !== 'sub' && !seen.has(r.id));
  if (rest.length) groups.push({ label: null, regions: rest });
  return groups;
}
