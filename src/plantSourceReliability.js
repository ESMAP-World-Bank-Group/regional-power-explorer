// Indicative plant-data coverage reliability, by region × source.
// OSM: best in Europe, sparse in Sub-Saharan Africa & small-island states.
// GPPD (WRI, frozen 2021, ~1 MW threshold): solid global baseline, strongest
//   where the fleet is large plants.
// GEM: unit-level, actively maintained, strongest for fossil-heavy systems.
// Levels are indicative, not measured — refine per evidence.

export const SOURCE_RELIABILITY = {
  eu:               { osm: 'high',   gppd: 'high',   gem: 'high'   },
  blacksea:         { osm: 'high',   gppd: 'high',   gem: 'high'   },
  balkans:          { osm: 'high',   gppd: 'high',   gem: 'medium' },
  centralasia:      { osm: 'medium', gppd: 'medium', gem: 'medium' },
  southasia:        { osm: 'medium', gppd: 'high',   gem: 'high'   },
  asean:            { osm: 'medium', gppd: 'high',   gem: 'high'   },
  panarab:          { osm: 'medium', gppd: 'high',   gem: 'high'   },
  siepac:           { osm: 'medium', gppd: 'medium', gem: 'medium' },
  wapp:             { osm: 'low',    gppd: 'medium', gem: 'medium' },
  eapp:             { osm: 'low',    gppd: 'medium', gem: 'medium' },
  capp:             { osm: 'low',    gppd: 'medium', gem: 'medium' },
  sapp:             { osm: 'low',    gppd: 'high',   gem: 'high'   },
  easa:             { osm: 'low',    gppd: 'medium', gem: 'medium' },
  sids:             { osm: 'low',    gppd: 'low',    gem: 'low'    },
  'sids-caribbean': { osm: 'medium', gppd: 'medium', gem: 'low'    },
  'sids-pacific':   { osm: 'low',    gppd: 'low',    gem: 'low'    },
  'sids-aims':      { osm: 'low',    gppd: 'low',    gem: 'low'    },
};

export const RELIABILITY_META = {
  high:   { color: '#1A9060', label: 'Good coverage' },
  medium: { color: '#B87820', label: 'Medium coverage' },
  low:    { color: '#B84040', label: 'Sparse coverage' },
};

// Returns { color, label } for a region/source, or null if not characterised.
export function sourceReliability(regionId, source) {
  const level = SOURCE_RELIABILITY[regionId]?.[source];
  return level ? RELIABILITY_META[level] : null;
}
