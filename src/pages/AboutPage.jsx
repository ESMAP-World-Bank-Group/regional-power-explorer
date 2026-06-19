import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../App';
import { getT } from '../constants';

const OPEN_DATA = [
  {
    category: 'Electricity Demand',
    rows: [
      { name: 'Our World in Data',   res: 'Yearly',         desc: 'Historical electricity consumption by country',          url: 'https://ourworldindata.org/energy' },
      { name: 'ENTSO-E Transparency',res: 'Monthly / hourly',desc: 'Load profiles for European countries (hourly, SFTP)',    url: 'https://transparency.entsoe.eu' },
      { name: 'SYNDE (GEGIS)',        res: 'Hourly',         desc: 'Modelled demand under SSP scenarios',                    url: 'https://github.com/Open-Poen/SYNDE' },
    ],
  },
  {
    category: 'Existing Generation Capacity',
    rows: [
      { name: 'PowerPlantMatching', res: 'Europe', desc: 'Matched plant database, CSV download', url: 'https://github.com/FRESNA/powerplantmatching' },
    ],
  },
  {
    category: 'Solar & Wind Profiles',
    rows: [
      { name: 'Renewables.ninja',   res: 'Hourly',  desc: 'Simulated PV and wind capacity factors at any location',   url: 'https://www.renewables.ninja' },
      { name: 'Global Wind Atlas', res: '—',       desc: 'Wind resource maps and data',                              url: 'https://globalwindatlas.info' },
      { name: 'atlite',            res: 'Hourly',  desc: 'Python library for weather-derived power profiles (ERA5)', url: 'https://atlite.readthedocs.io' },
      { name: 'Sterl et al. 2022', res: '—',       desc: 'PV and wind supply regions across Africa',                url: 'https://doi.org/10.1038/s41560-021-00922-4' },
    ],
  },
  {
    category: 'Hydropower',
    rows: [
      { name: 'EIA',                    res: 'Yearly',   desc: 'Historical hydro generation by country',                   url: 'https://www.eia.gov/international/data/world' },
      { name: 'GRDC',                   res: 'Monthly',  desc: 'Global river discharge and runoff data',                   url: 'https://grdc.bafg.de' },
      { name: 'FAO AQUASTAT',           res: '—',        desc: 'Geo-referenced database of dams and reservoirs',           url: 'https://www.fao.org/aquastat' },
      { name: 'Global Dam Watch',       res: '—',        desc: 'GRanD/FHReD: existing + future reservoir database',        url: 'https://globaldamwatch.org' },
    ],
  },
  {
    category: 'Comprehensive / Multi-category',
    rows: [
      { name: 'Ember',           res: '85+ geographies', desc: 'Global power data: generation, emissions, demand',         url: 'https://ember-energy.org/data' },
      { name: 'PyPSA-Earth',     res: 'Global',          desc: 'Open global electricity model with full data workflow',    url: 'https://pypsa-earth.readthedocs.io' },
      { name: 'ENERGYDATA.INFO', res: 'Global',          desc: 'World Bank open data platform for the energy sector',     url: 'https://energydata.info' },
      { name: 'OSeMOSYS Global', res: 'Global',          desc: 'Global energy system data (Brinkerink et al. 2021)',       url: 'https://doi.org/10.1038/s41597-021-01033-9' },
    ],
  },
];

const SOURCES = [
  {
    category: 'Electricity Demand',
    rows: [
      {
        layer:   'Annual demand · demand trend · peak demand',
        source:  'Country supply data files (national sources, Ember, OWID)',
        abbr:    'National / Ember / WDI',
        version: 'Per country',
        updated: '2022–2025',
        freq:    'Annual',
        coverage:'Most countries; source varies by country — see badge in Load tab',
        quality: 'Variable — source reliability differs by country. Official TSO data where available; cross-validated estimates elsewhere.',
        method:  'Primary: per-country supply JSON (sources: ENTSO-E, OWID/Ember, national TSOs). Fallback when no file: WB WDI EG.USE.ELEC.KH.PC × SP.POP.TOTL → national TWh total. Projection: OLS linear trend extrapolated +10 years. Peak demand: from supply data when available; otherwise estimated assuming load factor LF = 55% on annual hours basis.',
        url:     'https://data.worldbank.org',
      },
    ],
  },
  {
    category: 'Generation & Trade Statistics',
    rows: [
      {
        layer:   'Generation mix · installed capacity · cross-border flows',
        source:  'ENTSO-E Transparency Platform',
        abbr:    'ENTSO-E',
        version: 'A75 / A68 / A11',
        updated: '2024–2025',
        freq:    'Annual / monthly',
        coverage:'European countries (EU + neighbours)',
        quality: 'Good — official TSO-reported data. Covers generation by fuel type, capacity, and bilateral trade flows.',
        url:     'https://transparency.entsoe.eu',
      },
      {
        layer:   'Generation mix · installed capacity · electricity trade (Turkey)',
        source:  'Turkish Electricity Transmission Company',
        abbr:    'TEİAŞ',
        version: '—',
        updated: '2024',
        freq:    'Annual',
        coverage:'Turkey',
        quality: 'Good — official national statistics. Files 9, 26, 63 from TEİAŞ statistical yearbook.',
        url:     'https://www.teias.gov.tr',
      },
      {
        layer:   'Generation mix · installed capacity · electricity trade (Azerbaijan)',
        source:  'State Statistical Committee of Azerbaijan',
        abbr:    'SSC Azerbaijan',
        version: '—',
        updated: '2024–2025',
        freq:    'Annual',
        coverage:'Azerbaijan',
        quality: 'Good — official national statistics. Tables 5.3 & 5.4. Trade supplemented by Caliber.az / Galt & Taggart.',
        url:     'https://stat.gov.az',
      },
      {
        layer:   'Generation mix · installed capacity · electricity trade (Georgia)',
        source:  'ESCO Georgia · GNERC',
        abbr:    'ESCO / GNERC',
        version: '—',
        updated: '2024–2025',
        freq:    'Annual',
        coverage:'Georgia',
        quality: 'Good — ESCO annual electricity balance; trade from GNERC annual reports.',
        url:     'https://gnerc.org',
      },
    ],
  },
  {
    category: 'Power Plants',
    rows: [
      {
        layer:   'Plants · capacity',
        source:  'OpenStreetMap',
        abbr:    'OSM',
        version: '—',
        updated: 'Continuous',
        freq:    'Daily',
        coverage:'Global',
        quality: 'Variable — good density in Europe/Asia, sparse in Sub-Saharan Africa. Often missing MW values.',
        url:     'https://www.openstreetmap.org',
      },
      {
        layer:   'Plants · capacity · fleet age',
        source:  'WRI Global Power Plant Database',
        abbr:    'GPPD v1.3',
        version: 'v1.3',
        updated: '2021',
        freq:    'Ad hoc',
        coverage:'Global (~35 k plants)',
        quality: 'Good all-around coverage. Threshold ~1 MW. Frozen since 2021.',
        url:     'https://datasets.wri.org/dataset/globalpowerplantdatabase',
      },
      {
        layer:   'Plants · status (operating / construction / planned)',
        source:  'Global Energy Monitor',
        abbr:    'GEM',
        version: '2024–2025',
        updated: '2024–2025',
        freq:    'Semi-annual',
        coverage:'Global — fossil & RE trackers',
        quality: 'Best for fossil fuels (unit-level). Actively maintained. Requires manual download.',
        url:     'https://globalenergymonitor.org',
      },
    ],
  },
  {
    category: 'Grid Infrastructure',
    rows: [
      {
        layer:   'Transmission lines · substations',
        source:  'OpenStreetMap',
        abbr:    'OSM',
        version: '—',
        updated: 'Continuous',
        freq:    'Daily',
        coverage:'Global',
        quality: 'Best available open source. Coverage varies significantly by country.',
        url:     'https://www.openstreetmap.org',
      },
    ],
  },
  {
    category: 'Electricity Access',
    rows: [
      {
        layer:   'Access rates (total · urban · rural)',
        source:  'World Bank / SE4All',
        abbr:    'WB / SE4All',
        version: '—',
        updated: '~2022–2023',
        freq:    'Annual',
        coverage:'Global',
        quality: 'Official national statistics. Some countries report with 1–3 year lag.',
        url:     'https://trackingsdg7.esmap.org',
      },
    ],
  },
  {
    category: 'Electricity Tariffs',
    rows: [
      {
        layer:   'Residential · industrial tariffs',
        source:  'Various (IRENA, national utilities, ESMAP)',
        abbr:    'Mixed',
        version: '—',
        updated: '2022–2024',
        freq:    'Irregular',
        coverage:'Partial — not all countries covered',
        quality: 'Compiled manually. Precision varies. Use as indicative only.',
        url:     'https://www.irena.org',
      },
    ],
  },
  {
    category: 'RE Resources',
    rows: [
      {
        layer:   'Solar GHI · DNI · PVOUT · monthly profile',
        source:  'Global Solar Atlas',
        abbr:    'Solar Atlas',
        version: '—',
        updated: 'Continuous',
        freq:    'On demand (API)',
        coverage:'Global',
        quality: 'Good — ESMAP/World Bank product. Point query REST API.',
        method:  'Point query: Global Solar Atlas REST API returns GHI, DNI, PVOUT and monthly profiles at a coordinate. Map grid overlay: NASA POWER ALLSKY_SFC_SW_DWN climatology, annual mean × 365 = kWh/m²/yr, 1°×1° grid cells.',
        url:     'https://globalsolaratlas.info',
      },
      {
        layer:   'Wind speed 100m · monthly profile',
        source:  'ERA5 via Open-Meteo',
        abbr:    'ERA5 / Open-Meteo',
        version: '2014–2023',
        updated: '2024',
        freq:    'On demand (API)',
        coverage:'Global',
        quality: 'Good — ERA5 reanalysis, 0.25° resolution. Hellman correction to 100m applied.',
        method:  'NASA POWER WS50M climatology (wind speed at 50m AGL). Corrected to 100m using Hellman power law: v₁₀₀ = v₅₀ × (100/50)^α, α = 0.143 (open terrain). Grid cells 0.5°×0.5°.',
        url:     'https://open-meteo.com',
      },
      {
        layer:   'Electricity consumption per capita',
        source:  'World Bank WDI',
        abbr:    'WB WDI',
        version: '—',
        updated: '~2022',
        freq:    'Annual',
        coverage:'Global',
        quality: 'Good — official national statistics. Some lag.',
        url:     'https://data.worldbank.org',
      },
    ],
  },
  {
    category: 'Geography',
    rows: [
      {
        layer:   'Country boundaries',
        source:  'Natural Earth',
        abbr:    'Natural Earth',
        version: '110m',
        updated: '2024',
        freq:    'Ad hoc',
        coverage:'Global',
        quality: 'Standard for web mapping. 110 m resolution. Includes disputed territories.',
        url:     'https://www.naturalearthdata.com',
      },
    ],
  },
];

const QUALITY_COLOR = {
  'Good': '#40C057',
  'Variable': '#FCC419',
  'Partial': '#F03E3E',
};

function qualityChip(text, t) {
  const key = Object.keys(QUALITY_COLOR).find(k => text.startsWith(k));
  const color = QUALITY_COLOR[key] || '#888';
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      backgroundColor: color, marginRight: 5, flexShrink: 0,
      verticalAlign: 'middle', marginTop: -1,
    }} />
  );
}

export default function AboutPage() {
  const { theme } = useTheme();
  const t = getT(theme);
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    fetch('/data/metadata.json').then(r => r.ok ? r.json() : null).then(d => d && setMeta(d)).catch(() => {});
  }, []);

  const th = {
    fontSize: '0.5rem', letterSpacing: '1.5px', fontWeight: 700,
    color: t.lblMuted, textTransform: 'uppercase',
    padding: '6px 10px', textAlign: 'left',
    borderBottom: `1px solid ${t.panelBorder}`,
    whiteSpace: 'nowrap',
  };

  const td = {
    fontSize: '0.62rem', color: t.muted,
    padding: '8px 10px',
    borderBottom: `1px solid ${t.panelBorder}`,
    verticalAlign: 'top',
  };

  const sec = {
    fontSize: '0.5rem', letterSpacing: '2px', fontWeight: 700,
    color: t.lblMuted, textTransform: 'uppercase',
    marginBottom: 10, marginTop: 28, display: 'block',
  };

  return (
    <div style={{
      height: '100%', overflowY: 'auto',
      backgroundColor: t.bg, color: t.text,
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 32px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Link to="/" style={{ fontSize: '0.65rem', color: t.muted, letterSpacing: '1px' }}>
              ← Back to map
            </Link>
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: t.text, marginBottom: 8 }}>
            Data Sources
          </h1>
          <p style={{ fontSize: '0.75rem', color: t.muted, maxWidth: 620, lineHeight: 1.65 }}>
            The Regional Explorer aggregates open-access data from multiple sources.
            Coverage and accuracy vary by region. All data should be treated as indicative
            and cross-checked against national statistics for planning purposes.
          </p>
          {meta && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14,
              padding: '5px 12px', borderRadius: 20,
              backgroundColor: t.panel, border: `1px solid ${t.panelBorder}`,
              fontSize: '0.6rem', color: t.muted,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#40C057', flexShrink: 0, display: 'inline-block' }} />
              Data last refreshed:&nbsp;<strong style={{ color: t.lbl }}>
                {new Date(meta.lastUpdated + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </strong>
              &nbsp;·&nbsp;Target: semi-annual
            </div>
          )}
        </div>

        {/* Tables by category */}
        {SOURCES.map(({ category, rows }) => (
          <div key={category}>
            <span style={sec}>{category}</span>
            <div style={{
              borderRadius: 6, overflow: 'hidden',
              border: `1px solid ${t.panelBorder}`,
              marginBottom: 8,
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: t.panel }}>
                    <th style={th}>Layer</th>
                    <th style={th}>Source</th>
                    <th style={th}>Version</th>
                    <th style={th}>Last update</th>
                    <th style={th}>Frequency</th>
                    <th style={th}>Coverage</th>
                    <th style={{ ...th, whiteSpace: 'normal', minWidth: 200 }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} style={{
                      backgroundColor: i % 2 === 0 ? 'transparent' : (t.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)'),
                    }}>
                      <td style={{ ...td, color: t.lbl, fontWeight: 500 }}>{row.layer}</td>
                      <td style={td}>
                        <a href={row.url} target="_blank" rel="noopener noreferrer"
                          style={{ color: 'rgba(74,143,204,0.85)', textDecoration: 'none' }}>
                          {row.abbr}
                        </a>
                        <div style={{ fontSize: '0.52rem', color: t.lblMuted, marginTop: 2 }}>
                          {row.source}
                        </div>
                      </td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{row.version}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{row.updated}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{row.freq}</td>
                      <td style={td}>{row.coverage}</td>
                      <td style={{ ...td, color: t.lblMuted, lineHeight: 1.5 }}>
                        {qualityChip(row.quality, t)}
                        {row.quality}
                        {row.method && (
                          <div style={{
                            marginTop: 5, paddingTop: 5,
                            borderTop: `1px solid ${t.panelBorder}`,
                            fontSize: '0.52rem', fontStyle: 'italic', lineHeight: 1.55,
                            color: t.lblMuted,
                          }}>
                            {row.method}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* Legend */}
        <div style={{
          marginTop: 32, padding: '14px 16px', borderRadius: 6,
          border: `1px solid ${t.panelBorder}`,
          backgroundColor: t.panel,
        }}>
          <span style={{ ...sec, marginTop: 0, marginBottom: 8 }}>Quality indicator</span>
          <div style={{ display: 'flex', gap: 20 }}>
            {Object.entries(QUALITY_COLOR).map(([label, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, display: 'inline-block' }} />
                <span style={{ fontSize: '0.62rem', color: t.muted }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Additional Open Data Sources ── */}
        <div style={{ marginTop: 48 }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: t.text, marginBottom: 6 }}>
            Additional Open Data Sources
          </h2>
          <p style={{ fontSize: '0.72rem', color: t.muted, maxWidth: 600, lineHeight: 1.65, marginBottom: 6 }}>
            A curated list of open data sources useful for populating EPM inputs. Not currently integrated
            in the explorer — listed here for reference.
          </p>
          <div style={{
            padding: '8px 12px', borderRadius: 5, marginBottom: 24,
            backgroundColor: 'rgba(252,196,25,0.08)',
            border: '1px solid rgba(252,196,25,0.25)',
            fontSize: '0.6rem', color: t.muted, lineHeight: 1.55,
          }}>
            Work in progress — suggestions welcome via{' '}
            <a href="https://github.com/ESMAP-World-Bank-Group/regional-power-explorer/issues"
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'rgba(74,143,204,0.8)', textDecoration: 'none' }}>
              GitHub Issues
            </a>.
          </div>

          {OPEN_DATA.map(({ category, rows }) => (
            <div key={category}>
              <span style={sec}>{category}</span>
              <div style={{
                borderRadius: 6, overflow: 'hidden',
                border: `1px solid ${t.panelBorder}`, marginBottom: 8,
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: t.panel }}>
                      <th style={th}>Source</th>
                      <th style={th}>Resolution / Coverage</th>
                      <th style={{ ...th, whiteSpace: 'normal', minWidth: 220 }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} style={{
                        backgroundColor: i % 2 === 0 ? 'transparent'
                          : (t.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)'),
                      }}>
                        <td style={{ ...td, color: t.lbl, fontWeight: 500, whiteSpace: 'nowrap' }}>
                          <a href={row.url} target="_blank" rel="noopener noreferrer"
                            style={{ color: 'rgba(74,143,204,0.85)', textDecoration: 'none' }}>
                            {row.name}
                          </a>
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{row.res}</td>
                        <td style={{ ...td, color: t.lblMuted, lineHeight: 1.5 }}>{row.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* ── Limitations & Disclaimer ── */}
        <div style={{ marginTop: 48 }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: t.text, marginBottom: 6 }}>
            Limitations &amp; Disclaimer
          </h2>
          <p style={{ fontSize: '0.72rem', color: t.muted, maxWidth: 620, lineHeight: 1.65, marginBottom: 16 }}>
            This tool aggregates third-party open data for analytical reference. Figures should be
            cross-checked against authoritative national sources before use in policy, planning, or
            investment decisions.
          </p>
          <ul style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              'Data is indicative only. Figures reflect the reference year of each source and may be 1–3 years behind current conditions.',
              'Coverage varies significantly by country. SIDS and fragile states have the most data gaps — supply data is often partial, grid data sparse, and tariff figures may be absent.',
              'Power plant databases (GPPD v1.3, GEM) typically omit plants below ~1 MW and may not reflect recent commissioning or decommissioning.',
              'Electricity tariff data sourced from GlobalPetrolPrices.com is indicative only and may not reflect current regulated rates. Licence terms are under review.',
              'Load profiles are available only for countries with ENTSO-E hourly data. For all other countries the Load tab shows no intraday profile.',
              'Country boundaries are sourced from Natural Earth (110m resolution) for reference purposes only. Boundaries and names shown do not imply official endorsement or acceptance by the World Bank Group of any territorial delimitation.',
              'The findings, interpretations, and conclusions expressed in this tool are those of the author(s) and do not necessarily reflect the views of the World Bank, its Board of Executive Directors, or the governments they represent.',
            ].map((item, i) => (
              <li key={i} style={{ fontSize: '0.72rem', color: t.muted, lineHeight: 1.65 }}>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <p style={{ fontSize: '0.55rem', color: t.lblMuted, marginTop: 32, lineHeight: 1.7 }}>
          Regional Explorer · World Bank ·{' '}
          <a href="https://github.com/ESMAP-World-Bank-Group/regional-power-explorer"
            target="_blank" rel="noopener noreferrer"
            style={{ color: 'rgba(74,143,204,0.7)', textDecoration: 'none' }}>
            GitHub
          </a>
          {' '}· Data licences: OSM (ODbL), GPPD (CC BY 4.0), GEM (CC BY 4.0), Natural Earth (Public Domain)
        </p>
      </div>
    </div>
  );
}
