// Read-only MCP tools over compact publication JSON. The assistant deliberately
// avoids opening the large display GeoJSON files: MapLibre handles geometry;
// the model gets only the small analytical slices it needs. Plant, grid and
// zone summaries come from public/data/ai/, written by tools/prepare_ai.py.
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import files from 'virtual:data-manifest';
import { appPath } from '../utils/paths';
import { fetchData } from '../utils/dataCache';

// The app's shared data cache: a failed download is not kept, so a network blip
// no longer reads as "no data" until reload, and the chat shares the files the
// pages already loaded. undefined = not available, as the tools expect.
const getJson = path => fetchData(appPath(path)).catch(() => undefined);
const json = o => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const iso3 = z.string().length(3).transform(s => s.toUpperCase()).describe('ISO3 country code, e.g. KEN');
const last = arr => arr?.at(-1);
const byYear = (years, series) => Object.fromEntries((years ?? []).map((y, i) => [y, series?.[i]]));
const seriesByYear = (years, m) => Object.fromEntries(Object.entries(m ?? {}).map(([k, s]) => [k, byYear(years, s)]));
const has = path => files.includes(path);
const NOTE_LIMIT = 15000; // characters of note text per call

// ISO3 codes for a country or for every member of a region; null if neither resolves.
async function scope({ iso, regionId }) {
  if (iso) return [iso];
  const { regions = [] } = (await getJson('data/regions.json')) ?? {};
  const region = regions.find(r => r.id === regionId);
  return region ? region.countries.map(c => c.iso) : null;
}

// A country briefing note as text: header, figures and its h2 sections.
async function readNote(iso) {
  const res = await fetch(appPath(`data/notes/${iso}.html`)).catch(() => null);
  if (!res?.ok) return null;
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  doc.querySelectorAll('br').forEach(br => br.replaceWith(' '));
  const text = el => el?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  const sections = [];
  for (const el of doc.querySelector('.body')?.children ?? []) {
    if (el.tagName === 'H2') sections.push({ title: text(el), subsections: [], parts: [] });
    else if (sections.length) {
      const cur = sections.at(-1);
      if (el.tagName === 'H3') cur.subsections.push(text(el));
      cur.parts.push(el.tagName === 'H3' ? `## ${text(el)}` : text(el));
    }
  }
  return {
    title: text(doc.querySelector('.doc-title')),
    subtitle: text(doc.querySelector('.doc-sub')),
    keyFigures: [...doc.querySelectorAll('.kpi')].map(k => `${text(k.querySelector('.kpi-val'))} — ${text(k.querySelector('.kpi-lbl'))}`),
    sections: sections.map(({ title, subsections, parts }) => ({ title, subsections, text: parts.filter(Boolean).join('\n\n') })),
  };
}

export function buildDataServer() {
  const server = new McpServer({ name: 'data', version: '1.0.0' });

  server.tool('regions', 'List power pools/regions and member countries. Use this to resolve names to region ids and ISO3 codes.', {}, async () => {
    const { regions = [] } = (await getJson('data/regions.json')) ?? {};
    return json(regions.map(({ id, name, status, type, parent, countries, non_determined }) =>
      ({ id, name, status, type, parent, countries, non_determined })));
  });

  server.tool('capacity', 'Installed (operating) capacity in MW by fuel and country for a region, using one published plant dataset. Also returns GPPD fleet age where available. For planned and under-construction plants use data__pipeline.', {
    regionId: z.string().describe('region id from data__regions, e.g. wapp'),
    source: z.enum(['osm', 'gem', 'gppd']).default('gem'),
  }, async ({ regionId, source }) => {
    const suffix = source === 'osm' ? '' : `_${source}`;
    const [cap, age] = await Promise.all([
      getJson(`data/cache/region_capacity_${regionId}${suffix}.json`),
      getJson(`data/cache/region_age_${regionId}_gppd.json`),
    ]);
    if (!cap) return json({ available: false, message: `No ${source} capacity publication for region ${regionId}.` });
    return json({
      available: true,
      metric: 'installed capacity', unit: 'MW', plantDataset: source,
      countries: cap.countries,
      fleetAge: age ? { source: 'GPPD', referenceYear: age.reference_year, unit: 'years', countries: age.countries } : undefined,
    });
  });

  server.tool('supply', 'Generation and capacity by fuel for one country: every published year by fuel, latest values, annual totals, demand and peak demand. Returns the publication source strings.', { iso: iso3 }, async ({ iso }) => {
    const d = await getJson(`data/supply/${iso}.json`);
    if (!d) return json({ available: false, message: `No supply publication for ${iso}.` });
    const summarise = block => block && {
      source: block.source, unit: block.unit, note: block.note,
      latestYear: last(block.years),
      latestByFuel: Object.fromEntries(Object.entries(block.fuels ?? {}).map(([f, s]) => [f, last(s)])),
      byFuelByYear: seriesByYear(block.years, block.fuels),
      totalByYear: Object.fromEntries((block.years ?? []).map((y, i) => [y,
        Object.values(block.fuels ?? {}).reduce((a, series) => a + (Number(series[i]) || 0), 0)])),
      demandByYear: block.demand ? Object.fromEntries(block.years.map((y, i) => [y, block.demand[i]])) : undefined,
      peakDemandByYear: block.peak_demand ? Object.fromEntries(block.years.map((y, i) => [y, block.peak_demand[i]])) : undefined,
    };
    return json({ available: true, country: d.country, iso, generation: summarise(d.generation), capacity: summarise(d.capacity) });
  });

  server.tool('trade', 'Electricity imports and exports for one country: annual net imports, leading partners in the latest year, and every published year by partner.', {
    iso: iso3,
    topN: z.number().int().min(1).max(15).default(8),
  }, async ({ iso, topN }) => {
    const d = await getJson(`data/trade/${iso}.json`);
    if (!d) return json({ available: false, message: `No trade publication for ${iso}.` });
    const sum = m => d.years.map((_, i) => Object.values(m || {}).reduce((a, series) => a + (Number(series[i]) || 0), 0));
    const imp = sum(d.imports), exp = sum(d.exports);
    const top = m => Object.entries(m || {})
      .map(([partner, series]) => [partner, last(series)])
      .filter(([, value]) => Number(value) > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, topN);
    return json({
      available: true, country: d.country, iso, source: d.source, unit: d.unit,
      latestYear: last(d.years),
      netImportsByYear: Object.fromEntries(d.years.map((year, i) => [year, +(imp[i] - exp[i]).toFixed(1)])),
      latestTopImportPartners: Object.fromEntries(top(d.imports)),
      latestTopExportPartners: Object.fromEntries(top(d.exports)),
      importsByPartnerByYear: seriesByYear(d.years, d.imports),
      exportsByPartnerByYear: seriesByYear(d.years, d.exports),
    });
  });

  server.tool('indicators', 'Electricity access and retail tariffs for up to 30 countries from the explorer publications.', {
    isos: z.array(iso3).min(1).max(30),
  }, async ({ isos }) => {
    const [access, tariffs] = await Promise.all([getJson('data/access.json'), getJson('data/tariffs.json')]);
    return json({
      access: { year: access?.year, source: access?.source, unit: '% of population' },
      tariffs: { year: tariffs?.year, source: tariffs?.source, unit: 'USD/kWh' },
      countries: Object.fromEntries(isos.map(code => [code, {
        access: access?.countries?.[code], tariffs: tariffs?.countries?.[code],
      }])),
    });
  });

  const place = {
    iso: iso3.optional(),
    regionId: z.string().optional().describe('region id from data__regions; used when iso is not given'),
  };
  const noPlace = json({ available: false, message: 'Give an ISO3 code or a region id from data__regions.' });

  server.tool('pipeline', 'Planned and under-construction power plants (GEM): MW and plant counts by fuel and country, with operating MW for comparison. For a country or a whole region.', place, async args => {
    const isos = await scope(args);
    if (!isos) return noPlace;
    const countries = {};
    await Promise.all(isos.map(async code => {
      const gem = (await getJson(`data/ai/plants/${code}.json`))?.gem;
      if (!gem) return;
      const total = fuels => Math.round(Object.values(fuels ?? {}).reduce((a, [mw]) => a + mw, 0));
      countries[code] = {
        operatingMw: total(gem.byStatus.operating),
        constructionMw: total(gem.byStatus.construction),
        plannedMw: total(gem.byStatus.planned),
        constructionByFuel: gem.byStatus.construction ?? {},
        plannedByFuel: gem.byStatus.planned ?? {},
      };
    }));
    if (!Object.keys(countries).length) return json({ available: false, message: 'No GEM plant publication for this selection.' });
    return json({
      available: true, plantDataset: 'gem', source: 'Global Energy Monitor (GEM) power plant trackers', unit: 'MW',
      note: 'byFuel values are [MW, plant units]. Planned projects are announcements, not commitments.',
      countries,
    });
  });

  server.tool('plants', 'Largest individual power plants for a country or region from one plant dataset, optionally filtered by fuel and status. Up to 10 plants per fuel and status are published per country.', {
    ...place,
    source: z.enum(['osm', 'gem', 'gppd']).default('gem'),
    fuel: z.string().optional().describe('e.g. solar wind hydro gas coal nuclear oil geothermal'),
    status: z.enum(['operating', 'construction', 'planned']).optional().describe('GEM only; OSM and GPPD list operating plants'),
    limit: z.number().int().min(1).max(50).default(15),
  }, async ({ source, fuel, status, limit, ...args }) => {
    const isos = await scope(args);
    if (!isos) return noPlace;
    const rows = (await Promise.all(isos.map(async code =>
      ((await getJson(`data/ai/plants/${code}.json`))?.[source]?.top ?? []).map(r => [code, ...r]))))
      .flat()
      .filter(([, , f, , st]) => (!fuel || f === fuel.toLowerCase()) && (!status || st === status))
      .sort((a, b) => b[3] - a[3])
      .slice(0, limit);
    if (!rows.length) return json({ available: false, message: `No ${source} plants match this selection.` });
    return json({
      available: true, plantDataset: source, unit: 'MW',
      plants: rows.map(([country, name, f, mw, st, units]) => ({ country, name, fuel: f, mw, status: st, units })),
    });
  });

  server.tool('grid', 'Transmission network of a region (OpenStreetMap): line count and km by voltage class, operators with the most km, and substations by voltage class. Region totals only; lines are not split by country.', {
    regionId: z.string().describe('region id from data__regions'),
  }, async ({ regionId }) => {
    const d = await getJson(`data/ai/grid/${regionId}.json`);
    if (!d) return json({ available: false, message: `No grid publication for region ${regionId}.` });
    return json({
      available: true, source: 'OpenStreetMap', regionId, ...d,
      note: 'Lengths are computed from mapped geometry. OSM coverage varies by country; untagged voltages are "unknown".',
    });
  });

  server.tool('market', 'Wholesale electricity market prices and volumes for a country (currently Türkiye only): yearly mean/min/max and monthly means for day-ahead, intraday and balancing markets.', {
    iso: iso3,
    fromYear: z.number().int().optional().describe('first year of monthly values; default: the last 24 months'),
  }, async ({ iso, fromYear }) => {
    const d = await getJson(`data/market/${iso}.json`);
    if (!d) return json({ available: false, message: `No market publication for ${iso}. Market data is published for TUR only.` });
    const series = Object.fromEntries(Object.entries(d)
      .filter(([, v]) => v && typeof v === 'object' && v.yearly)
      .map(([key, v]) => {
        const months = Object.entries(v.monthly?.mean ?? {}).sort(([a], [b]) => a.localeCompare(b));
        return [key, {
          label: v.label, unit: v.unit, yearly: v.yearly,
          monthlyMean: Object.fromEntries(fromYear ? months.filter(([m]) => +m.slice(0, 4) >= fromYear) : months.slice(-24)),
        }];
      }));
    return json({ available: true, country: d.country, iso, source: d.source, updated: d.updated, series });
  });

  server.tool('zones', 'Planning-model zones for a country, for every published zone count: each zone\'s operating plants (OSM) by fuel in MW, and which zones are connected.', { iso: iso3 }, async ({ iso }) => {
    const d = await getJson(`data/ai/zones/${iso}.json`);
    if (!d) return json({ available: false, message: `No zoning publication for ${iso}.` });
    return json({ available: true, iso, plantDataset: 'osm', unit: 'MW', byZoneCount: d });
  });

  server.tool('load_centres', 'Main demand centres (cities with population) for a region, optionally one country. Currently published for the Black Sea region only.', {
    regionId: z.string().describe('region id from data__regions'),
    iso: iso3.optional(),
  }, async ({ regionId, iso }) => {
    const d = await getJson(`data/region_load_centers_${regionId}.geojson`);
    if (!d) return json({ available: false, message: `No load-centre publication for region ${regionId}.` });
    const cities = d.features.map(f => f.properties)
      .filter(p => !iso || p.iso === iso)
      .sort((a, b) => b.pop - a.pop)
      .map(({ name, iso: country, pop }) => ({ name, country, population: pop }));
    return json({ available: true, regionId, cities });
  });

  server.tool('country_note', 'Sector briefing note for a country: context, the electricity system, sector actors, key issues and takeaways. Without section: key figures, the outline and the takeaways. With section: that section\'s full text.', {
    iso: iso3,
    section: z.string().optional().describe('section number or part of its title, e.g. "3" or "actors"'),
  }, async ({ iso, section }) => {
    const note = await readNote(iso);
    if (!note) return json({ available: false, message: `No briefing note for ${iso}.` });
    const caution = 'AI-drafted briefing note, not fact-checked. Use it for context; take figures from the data tools and say when they differ.';
    const pick = section && note.sections.find(s =>
      s.title.toLowerCase().startsWith(`${section}.`) || s.title.toLowerCase().includes(section.toLowerCase()));
    if (section && !pick) return json({ available: false, message: `No section "${section}"`, outline: note.sections.map(s => s.title) });
    return json({
      available: true, iso, caution, title: note.title, subtitle: note.subtitle,
      ...(pick
        ? { section: pick.title, text: pick.text.slice(0, NOTE_LIMIT) }
        : {
          keyFigures: note.keyFigures,
          outline: note.sections.map(({ title, subsections }) => ({ title, subsections })),
          takeaways: note.sections.at(-1)?.text.slice(0, NOTE_LIMIT),
        }),
    });
  });

  server.tool('fuel_detail', 'ENTSO-E\'s finer fuel split for a European country: hydro run-of-river vs reservoir vs pumped storage, lignite vs hard coal, onshore vs offshore wind, for generation and capacity. ENTSO-E totals are often incomplete: use this for the split within a fuel, and take totals from data__supply.', { iso: iso3 }, async ({ iso }) => {
    const [d, supply] = await Promise.all([getJson(`data/entsoe/${iso}.json`), getJson(`data/supply/${iso}.json`)]);
    if (!d) return json({ available: false, message: `No ENTSO-E detail for ${iso}. It exists for European ENTSO-E members only.` });
    const GROUPS = {
      hydro: ['Hydro RoR', 'Hydro Reservoir', 'Hydro Pumped Storage'],
      coal: ['Lignite', 'Coal'],
      wind: ['Wind', 'Wind Offshore'],
    };
    const total = (b, i) => Object.entries(b.fuels).reduce((a, [f, s]) => a + (f === 'Hydro Pumped Storage' ? 0 : Number(s[i]) || 0), 0);
    const detail = (b, ref) => {
      if (!b) return undefined;
      const i = b.years.length - 1, year = b.years[i];
      const value = f => b.fuels[f]?.[i] ?? null;
      const j = ref?.years.indexOf(year) ?? -1;
      return {
        source: b.source, unit: b.unit, latestYear: year,
        coverageOfEmberTotal: j >= 0 && total(ref, j) ? +(total(b, i) / total(ref, j)).toFixed(2) : null,
        byFuel: Object.fromEntries(Object.keys(b.fuels).map(f => [f, value(f)])),
        splits: Object.fromEntries(Object.entries(GROUPS).map(([g, fuels]) => {
          const vals = fuels.filter(f => value(f) > 0).map(f => [f, value(f)]);
          const sum = vals.reduce((a, [, v]) => a + v, 0);
          return [g, sum ? Object.fromEntries(vals.map(([f, v]) => [f, { value: v, share: +(v / sum).toFixed(2) }])) : null];
        })),
      };
    };
    return json({
      available: true, iso, country: d.country,
      note: '"Coal" is hard coal. Pumped storage stores power rather than generating it. coverageOfEmberTotal is ENTSO-E\'s total as a share of the explorer\'s supply total for that year; below about 0.9 the split may miss plants.',
      generation: detail(d.generation, supply?.generation),
      capacity: detail(d.capacity, supply?.capacity),
    });
  });

  server.tool('re_resources', 'Solar and wind resource for a country: averages over the whole country, median and best 10%, with monthly profiles. Solar GHI, DNI, PV output and PV capacity factor (Global Solar Atlas); wind speed, power density and capacity factor at 100 m (Global Wind Atlas v4).', {
    isos: z.array(iso3).min(1).max(30),
  }, async ({ isos }) => {
    const countries = Object.fromEntries(await Promise.all(isos.map(async code => [code, (await getJson(`data/re/${code}.json`)) ?? null])));
    if (!Object.values(countries).some(Boolean)) return json({ available: false, message: 'No resource figures for these countries.' });
    return json({
      available: true,
      note: 'Whole-country averages weighted by area, not limited to buildable land. p90 = value the best tenth of the country reaches. Wind capacity factor is modelled for one IEC class 2 turbine everywhere; real fleets usually run lower. Monthly profiles: NASA POWER shape scaled to the annual averages.',
      countries,
    });
  });

  server.tool('coverage', 'What the explorer publishes for a country (supply, trade, market, plant datasets, zoning, renewable resources, briefing note) and its regions, plus when the data was last updated. Use this before saying data is missing.', { iso: iso3 }, async ({ iso }) => {
    const [{ regions = [] } = {}, meta, access, tariffs] = await Promise.all(
      ['regions', 'metadata', 'access', 'tariffs'].map(name => getJson(`data/${name}.json`)));
    const plants = (await getJson(`data/ai/plants/${iso}.json`)) ?? {};
    return json({
      iso,
      regions: regions.filter(r => r.countries?.some(c => c.iso === iso)).map(r => r.id),
      supply: has(`supply/${iso}.json`),
      trade: has(`trade/${iso}.json`),
      market: has(`market/${iso}.json`),
      zoning: has(`ai/zones/${iso}.json`),
      briefingNote: has(`notes/${iso}.html`),
      reResources: has(`re/${iso}.json`),
      entsoeFuelDetail: has(`entsoe/${iso}.json`),
      plantDatasets: Object.keys(plants),
      access: Boolean(access?.countries?.[iso]),
      tariffs: Boolean(tariffs?.countries?.[iso]),
      lastUpdated: meta?.lastUpdated, sources: meta?.note,
    });
  });

  return server;
}
