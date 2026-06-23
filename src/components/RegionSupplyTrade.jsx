import { useState, useEffect } from 'react';
import { getT, FUEL_COLORS, COUNTRY_ZONE_COLORS } from '../constants';

// ── helpers ───────────────────────────────────────────────────────────────────
function niceTicks(maxVal) {
  if (!maxVal || maxVal <= 0) return [0];
  const raw = maxVal / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].find(f => f * mag >= raw) * mag;
  const ticks = [0];
  for (let v = nice; v <= maxVal + nice; v += nice) ticks.push(Math.round(v));
  return ticks;
}
const fmt = v =>
  v == null ? '—'
  : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
  : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k`
  : `${Math.round(v)}`;

function matchFuelColor(name) {
  const n = name.toLowerCase();
  if (n.includes('coal')) return FUEL_COLORS.coal;
  if (n.includes('gas')) return FUEL_COLORS.gas;
  if (n.includes('hydro') && (n.includes('ror') || n.includes('run'))) return '#1ABDE0';
  if (n.includes('hydro')) return FUEL_COLORS.hydro;
  if (n.includes('solar')) return FUEL_COLORS.solar;
  if (n.includes('geothermal')) return FUEL_COLORS.geothermal;
  if (n.includes('wind')) return FUEL_COLORS.wind;
  if (n.includes('nuclear')) return FUEL_COLORS.nuclear;
  if (n.includes('oil')) return FUEL_COLORS.oil;
  if (n.includes('biomass') || n.includes('bioenergy') || n.includes('wood')) return FUEL_COLORS.biomass;
  if (n.includes('waste') || n.includes('other') || n.includes('thermal')) return FUEL_COLORS.waste;
  return '#9AA6B2';
}

const _PALETTE = [
  '#2478B4', '#E8B820', '#2AADA0', '#B8720A', '#4E79A7', '#0E8070',
  '#7EC8E0', '#C0506A', '#5A9EC8', '#1A9080', '#8AAEC0', '#6ACAD8',
  '#9A7040', '#3CBFB0', '#A8986C', '#5888A0', '#0D5C8A', '#7AC030',
];
function countryColor(iso, i) {
  return COUNTRY_ZONE_COLORS?.[iso] || _PALETTE[i % _PALETTE.length];
}

// ── aggregation ───────────────────────────────────────────────────────────────
function aggregateSupply(supplies, key) {
  const yearsSet = new Set();
  let unit = key === 'capacity' ? 'MW' : 'GWh';
  for (const s of supplies) {
    const g = s?.[key];
    if (g?.years) { g.years.forEach(y => yearsSet.add(y)); if (g.unit) unit = g.unit; }
  }
  const years = [...yearsSet].sort((a, b) => a - b);
  if (!years.length) return null;
  const fuels = {};
  const demand = years.map(() => 0);
  let hasDemand = false;
  for (const s of supplies) {
    const g = s?.[key];
    if (!g?.years) continue;
    years.forEach((Y, yi) => {
      const idx = g.years.indexOf(Y);
      if (idx < 0) return;
      for (const [f, arr] of Object.entries(g.fuels || {})) {
        if (!fuels[f]) fuels[f] = years.map(() => 0);
        fuels[f][yi] += arr[idx] || 0;
      }
      const d = g.demand?.[idx];
      if (d != null) { demand[yi] += d; hasDemand = true; }
    });
  }
  // drop all-zero fuels, order by total desc
  const entries = Object.entries(fuels)
    .filter(([, a]) => a.some(v => v > 0))
    .sort(([, a], [, b]) => b.reduce((s, v) => s + v, 0) - a.reduce((s, v) => s + v, 0));
  return { years, fuels: Object.fromEntries(entries), demand: hasDemand ? demand : null, unit };
}

function aggregateNetTrade(tradeByIso, members) {
  const yearsSet = new Set();
  const rows = [];
  members.forEach(({ iso, name }, i) => {
    const d = tradeByIso[iso];
    if (!d || d.status) return;
    const imp = d.imports || {}, exp = d.exports || {};
    if (!Object.keys(imp).length && !Object.keys(exp).length) return;
    d.years.forEach(y => yearsSet.add(y));
    const net = {};
    d.years.forEach((Y, idx) => {
      const im = Object.values(imp).reduce((s, a) => s + (a[idx] || 0), 0);
      const ex = Object.values(exp).reduce((s, a) => s + (a[idx] || 0), 0);
      net[Y] = im - ex;                       // >0 = net importer, <0 = net exporter
    });
    rows.push({ iso, name, net, color: countryColor(iso, i) });
  });
  const years = [...yearsSet].sort((a, b) => a - b);
  return years.length ? { years, rows } : null;
}

// ── Diverging stacked bar: net trade by country ──────────────────────────────
function NetTradeChart({ data, t }) {
  const W = 320, H = 190, pL = 42, pR = 8, pT = 10, pB = 24;
  const iW = W - pL - pR, iH = H - pT - pB;
  const { years, rows } = data;

  const posTot = years.map((Y) => rows.reduce((s, r) => s + Math.max(r.net[Y] || 0, 0), 0));
  const negTot = years.map((Y) => rows.reduce((s, r) => s + Math.min(r.net[Y] || 0, 0), 0));
  const maxPos = Math.max(...posTot, 1);
  const maxNeg = Math.max(...negTot.map(v => -v), 1);
  const posTicks = niceTicks(maxPos), negTicks = niceTicks(maxNeg);
  const axisPos = posTicks[posTicks.length - 1] || 1;
  const axisNeg = negTicks[negTicks.length - 1] || 1;
  const posH = iH * axisPos / (axisPos + axisNeg);
  const negH = iH - posH;
  const zeroY = pT + posH;
  const toY = v => v >= 0 ? zeroY - (v / axisPos) * posH : zeroY + (-v / axisNeg) * negH;

  const slotW = iW / years.length;
  const barW = Math.max(slotW * 0.7, 1.5);
  const barX = i => pL + i * slotW + (slotW - barW) / 2;
  const yrStep = years.length > 15 ? 5 : years.length > 8 ? 2 : 1;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      <text transform={`translate(8,${pT + iH / 2}) rotate(-90)`} textAnchor="middle" fill={t.lblMuted} fontSize={6}>GWh net</text>
      {posTicks.slice(1).map(tk => (
        <g key={`p${tk}`}>
          <line x1={pL} x2={pL + iW} y1={toY(tk)} y2={toY(tk)} stroke={t.panelBorder} strokeWidth={0.4} strokeDasharray="2,3" />
          <text x={pL - 3} y={toY(tk) + 3} textAnchor="end" fill={t.lblMuted} fontSize={6}>{fmt(tk)}</text>
        </g>
      ))}
      {negTicks.slice(1).map(tk => (
        <g key={`n${tk}`}>
          <line x1={pL} x2={pL + iW} y1={toY(-tk)} y2={toY(-tk)} stroke={t.panelBorder} strokeWidth={0.4} strokeDasharray="2,3" />
          <text x={pL - 3} y={toY(-tk) + 3} textAnchor="end" fill={t.lblMuted} fontSize={6}>−{fmt(tk)}</text>
        </g>
      ))}
      <line x1={pL} x2={pL + iW} y1={zeroY} y2={zeroY} stroke={t.lblMuted} strokeWidth={0.7} />
      <text x={pL - 3} y={zeroY + 3} textAnchor="end" fill={t.lblMuted} fontSize={6}>0</text>
      <line x1={pL} x2={pL} y1={pT} y2={pT + iH} stroke={t.lblMuted} strokeWidth={0.4} />

      {years.map((Y, yi) => {
        const x = barX(yi);
        let posBase = 0, negBase = 0;
        return (
          <g key={Y}>
            {rows.map(r => {
              const v = r.net[Y] || 0;
              if (v > 0) {
                const h = (v / axisPos) * posH;
                const y = zeroY - ((posBase + v) / axisPos) * posH;
                posBase += v;
                return <rect key={r.iso} x={x} y={y} width={barW} height={Math.max(h, 0.3)} fill={r.color} opacity={0.9} />;
              }
              if (v < 0) {
                const h = (-v / axisNeg) * negH;
                const y = zeroY + (negBase / axisNeg) * negH;
                negBase += -v;
                return <rect key={r.iso} x={x} y={y} width={barW} height={Math.max(h, 0.3)} fill={r.color} opacity={0.9} />;
              }
              return null;
            })}
            {Y % yrStep === 0 && (
              <text x={x + barW / 2} y={pT + iH + 9} textAnchor="middle" fill={t.lblMuted} fontSize={5.8}>{Y}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Stacked bar: generation / capacity by fuel ───────────────────────────────
function FuelChart({ section, t }) {
  const W = 320, H = 190, pL = 42, pR = 8, pT = 10, pB = 24;
  const iW = W - pL - pR, iH = H - pT - pB;
  const { years, fuels, demand, unit } = section;
  const allFuels = Object.keys(fuels);
  const totals = years.map((_, yi) => allFuels.reduce((s, f) => s + (fuels[f][yi] || 0), 0));
  const dVals = (demand || []).filter(v => v != null);
  const maxVal = Math.max(...totals, dVals.length ? Math.max(...dVals) : 0, 1);
  const ticks = niceTicks(maxVal);
  const axisMax = ticks[ticks.length - 1] || 1;
  const toY = v => pT + iH - (v / axisMax) * iH;
  const slotW = iW / years.length;
  const barW = Math.max(slotW * 0.7, 1.5);
  const barX = i => pL + i * slotW + (slotW - barW) / 2;
  const yrStep = years.length > 15 ? 5 : years.length > 8 ? 2 : 1;
  const dPts = demand
    ? demand.map((v, i) => v != null ? `${(barX(i) + barW / 2).toFixed(1)},${toY(v).toFixed(1)}` : null).filter(Boolean).join(' ')
    : '';

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      <text transform={`translate(8,${pT + iH / 2}) rotate(-90)`} textAnchor="middle" fill={t.lblMuted} fontSize={6}>{unit}</text>
      {ticks.map(tk => (
        <g key={tk}>
          {tk > 0 && <line x1={pL} x2={pL + iW} y1={toY(tk)} y2={toY(tk)} stroke={t.panelBorder} strokeWidth={0.4} strokeDasharray="2,3" />}
          <text x={pL - 3} y={toY(tk) + 3} textAnchor="end" fill={t.lblMuted} fontSize={6}>{fmt(tk)}</text>
        </g>
      ))}
      <line x1={pL} x2={pL} y1={pT} y2={pT + iH} stroke={t.lblMuted} strokeWidth={0.4} />
      <line x1={pL} x2={pL + iW} y1={pT + iH} y2={pT + iH} stroke={t.lblMuted} strokeWidth={0.4} />
      {years.map((Y, yi) => {
        let base = 0;
        const x = barX(yi);
        return (
          <g key={Y}>
            {allFuels.map(f => {
              const v = fuels[f][yi] || 0;
              if (v <= 0) return null;
              const h = (v / axisMax) * iH;
              const y = toY(base + v);
              base += v;
              return <rect key={f} x={x} y={y} width={barW} height={Math.max(h, 0.3)} fill={matchFuelColor(f)} opacity={0.9} />;
            })}
            {Y % yrStep === 0 && (
              <text x={x + barW / 2} y={pT + iH + 9} textAnchor="middle" fill={t.lblMuted} fontSize={5.8}>{Y}</text>
            )}
          </g>
        );
      })}
      {dPts && <polyline points={dPts} fill="none" stroke={t.lbl} strokeWidth={1.2} strokeDasharray="3,2" opacity={0.7} />}
    </svg>
  );
}

function Legend({ items, t }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', marginTop: 6 }}>
      {items.map(({ label, color }) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.52rem', color: t.lblMuted }}>
          <span style={{ width: 7, height: 7, borderRadius: 1, backgroundColor: color, flexShrink: 0 }} />
          {label}
        </span>
      ))}
    </div>
  );
}

const secStyle = t => ({
  fontSize: '0.5rem', letterSpacing: '2px', fontWeight: 700,
  color: t.lblMuted, textTransform: 'uppercase', marginBottom: 7, display: 'block',
});

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RegionSupplyTrade({ region, theme }) {
  const t = getT(theme);
  const [supplies, setSupplies] = useState(null);
  const [tradeByIso, setTradeByIso] = useState(null);
  const [view, setView] = useState('generation');

  useEffect(() => {
    if (!region) return;
    setSupplies(null); setTradeByIso(null);
    let cancelled = false;
    const members = region.countries.map(c => ({ iso: c.iso, name: c.name }));
    Promise.all(members.map(({ iso }) =>
      Promise.all([
        fetch(`/data/supply/${iso}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/data/trade/${iso}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]),
    )).then(results => {
      if (cancelled) return;
      const sup = [], trd = {};
      results.forEach(([s, tr], i) => { if (s) sup.push(s); trd[members[i].iso] = tr; });
      setSupplies(sup); setTradeByIso(trd);
    });
    return () => { cancelled = true; };
  }, [region]);

  if (!supplies || !tradeByIso) {
    return <p style={{ fontSize: '0.7rem', color: t.muted, fontStyle: 'italic' }}>Loading…</p>;
  }

  const members = region.countries.map(c => ({ iso: c.iso, name: c.name }));
  const net = aggregateNetTrade(tradeByIso, members);
  const supplySec = aggregateSupply(supplies, view);

  const toggleBtn = (v, lbl) => (
    <button key={v} onClick={() => setView(v)} style={{
      fontSize: '0.47rem', letterSpacing: '0.5px', textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
      border: `1px solid ${view === v ? 'rgba(74,143,204,0.6)' : t.panelBorder}`,
      backgroundColor: view === v ? 'rgba(74,143,204,0.1)' : 'transparent',
      color: view === v ? t.lbl : t.lblMuted,
    }}>{lbl}</button>
  );

  return (
    <div>
      {/* ── Cross-border trade: net by country ── */}
      <div style={{ marginBottom: 20 }}>
        <span style={secStyle(t)}>Cross-border Trade · Net Position by Country</span>
        {net ? (
          <>
            <NetTradeChart data={net} t={t} />
            <Legend items={net.rows.map(r => ({ label: r.iso, color: r.color }))} t={t} />
            <p style={{ fontSize: '0.5rem', color: t.lblMuted, fontStyle: 'italic', marginTop: 6, lineHeight: 1.5 }}>
              Net imports (imports − exports) per member, by year. Above zero = net importer, below = net exporter.
            </p>
          </>
        ) : (
          <p style={{ fontSize: '0.7rem', color: t.lblMuted, fontStyle: 'italic' }}>No trade data available for this region.</p>
        )}
      </div>

      {/* ── Generation / Capacity by fuel ── */}
      <div style={{ borderTop: `1px solid ${t.panelBorder}`, paddingTop: 14 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {toggleBtn('generation', 'Generation')}
          {toggleBtn('capacity', 'Capacity')}
        </div>
        {supplySec ? (
          <>
            <FuelChart section={supplySec} t={t} />
            <Legend items={Object.keys(supplySec.fuels).map(f => ({ label: f, color: matchFuelColor(f) }))} t={t} />
            {supplySec.demand && (
              <p style={{ fontSize: '0.5rem', color: t.lblMuted, fontStyle: 'italic', marginTop: 6, lineHeight: 1.5 }}>
                Aggregated across member countries. Dashed line = electricity demand.
              </p>
            )}
          </>
        ) : (
          <p style={{ fontSize: '0.7rem', color: t.lblMuted, fontStyle: 'italic' }}>No {view} data available.</p>
        )}
      </div>
    </div>
  );
}
