import { useState, useEffect } from 'react';
import { FUEL_COLORS, getT } from '../../constants';

function matchFuelColor(name) {
  const n = name.toLowerCase();
  if (n.includes('coal'))                         return FUEL_COLORS.coal;
  if (n.includes('gas'))                          return FUEL_COLORS.gas;
  if (n.includes('hydro'))                        return FUEL_COLORS.hydro;
  if (n.includes('solar'))                        return FUEL_COLORS.solar;
  if (n.includes('geothermal'))                   return FUEL_COLORS.geothermal;
  if (n.includes('wind'))                         return FUEL_COLORS.wind;
  if (n.includes('nuclear'))                      return FUEL_COLORS.nuclear;
  if (n.includes('oil'))                          return FUEL_COLORS.oil;
  if (n.includes('biomass') || n.includes('wood')) return FUEL_COLORS.biomass;
  if (n.includes('waste') || n.includes('other') || n.includes('thermal')) return FUEL_COLORS.waste;
  return '#aaa';
}

function niceTicks(maxVal) {
  if (!maxVal || maxVal <= 0) return [0];
  const raw = maxVal / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].find(f => f * mag >= raw) * mag;
  const ticks = [0];
  for (let v = nice; v <= maxVal * 1.12; v += nice) ticks.push(Math.round(v));
  return ticks;
}

function StackedBarChart({ section, demandKey, t }) {
  const W = 300, H = 185, pL = 40, pR = 6, pT = 8, pB = 28;
  const iW = W - pL - pR, iH = H - pT - pB;

  const { years, fuels, unit } = section;
  const demand = section[demandKey] || [];
  const fuelNames = Object.keys(fuels);

  const totals = years.map((_, yi) =>
    fuelNames.reduce((s, f) => s + (fuels[f][yi] ?? 0), 0)
  );
  const demandVals = demand.filter(v => v != null);
  const maxVal = Math.max(...totals, demandVals.length ? Math.max(...demandVals) : 0);

  const ticks = niceTicks(maxVal);
  const axisMax = ticks[ticks.length - 1] || 1;

  const toY  = v => pT + iH - (v / axisMax) * iH;
  const slotW = iW / years.length;
  const barW  = Math.max(slotW * 0.76, 1.5);
  const barX  = i => pL + i * slotW + (slotW - barW) / 2;

  const dPts = demand
    .map((v, i) => v != null ? `${(barX(i) + barW / 2).toFixed(1)},${toY(v).toFixed(1)}` : null)
    .filter(Boolean).join(' ');

  const fmt = v =>
    v >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
    : v >= 1000 ? `${(v / 1000).toFixed(0)}k`
    : `${v}`;

  const yrStep = years.length > 15 ? 5 : years.length > 8 ? 2 : 1;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* Y-axis label */}
      <text
        transform={`translate(8,${pT + iH / 2}) rotate(-90)`}
        textAnchor="middle" fill={t.lblMuted} fontSize={6}
      >{unit}</text>

      {/* grid + y ticks */}
      {ticks.map(tick => (
        <g key={tick}>
          {tick > 0 && (
            <line x1={pL} x2={pL + iW} y1={toY(tick)} y2={toY(tick)}
              stroke={t.panelBorder} strokeWidth={0.4} strokeDasharray="2,3" />
          )}
          <text x={pL - 3} y={toY(tick) + 3} textAnchor="end"
            fill={t.lblMuted} fontSize={6.5}>{fmt(tick)}</text>
        </g>
      ))}

      {/* axes */}
      <line x1={pL} x2={pL} y1={pT} y2={pT + iH} stroke={t.lblMuted} strokeWidth={0.4} />
      <line x1={pL} x2={pL + iW} y1={pT + iH} y2={pT + iH} stroke={t.lblMuted} strokeWidth={0.4} />

      {/* stacked bars */}
      {years.map((yr, yi) => {
        let base = 0;
        const x = barX(yi);
        return (
          <g key={yr}>
            {fuelNames.map(f => {
              const v = fuels[f][yi] ?? 0;
              if (v <= 0) return null;
              const h = (v / axisMax) * iH;
              const y = toY(base + v);
              base += v;
              return (
                <rect key={f} x={x} y={y} width={barW} height={Math.max(h, 0.3)}
                  fill={matchFuelColor(f)} opacity={0.88} />
              );
            })}
            {yr % yrStep === 0 && (
              <text x={x + barW / 2} y={pT + iH + 9} textAnchor="middle"
                fill={t.lblMuted} fontSize={5.8}>{yr}</text>
            )}
          </g>
        );
      })}

      {/* demand line */}
      {dPts && (
        <polyline points={dPts} fill="none" stroke={t.lbl}
          strokeWidth={1.2} strokeDasharray="3,2" opacity={0.7}
          strokeLinejoin="round" strokeLinecap="round" />
      )}
    </svg>
  );
}

export default function SupplyTab({ iso, theme }) {
  const t = getT(theme);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState('generation');

  useEffect(() => {
    if (!iso) return;
    setLoading(true);
    setData(null);
    fetch(`/data/supply/${iso}.json`)
      .then(r => { if (!r.ok) throw new Error('404'); return r.json(); })
      .then(d  => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [iso]);

  if (loading) return (
    <p style={{ fontSize: '0.7rem', color: t.lblMuted, marginTop: 8 }}>Loading…</p>
  );
  if (!data) return (
    <p style={{ fontSize: '0.7rem', color: t.lblMuted, marginTop: 8, fontStyle: 'italic' }}>
      No supply data available for this country.
    </p>
  );

  const section    = view === 'generation' ? data.generation : data.capacity;
  const demandKey  = view === 'generation' ? 'demand' : 'peak_demand';
  const demandLabel = view === 'generation' ? 'Demand (grid)' : 'Peak demand';
  const fuelNames  = Object.keys(section.fuels);
  const hasDemand  = (section[demandKey] || []).some(v => v != null);

  return (
    <div>
      {/* toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {[['generation', 'Generation'], ['capacity', 'Capacity']].map(([v, lbl]) => (
          <button key={v} onClick={() => setView(v)} style={{
            fontSize: '0.47rem', letterSpacing: '0.5px', textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${view === v ? 'rgba(74,143,204,0.6)' : t.panelBorder}`,
            backgroundColor: view === v ? 'rgba(74,143,204,0.1)' : 'transparent',
            color: view === v ? t.lbl : t.lblMuted,
          }}>{lbl}</button>
        ))}
      </div>

      {/* source + note */}
      <p style={{ fontSize: '0.58rem', color: t.lblMuted, margin: '0 0 2px' }}>
        {section.source}
      </p>
      {section.note && (
        <p style={{ fontSize: '0.55rem', color: t.lblMuted, fontStyle: 'italic', margin: '0 0 8px' }}>
          {section.note}
        </p>
      )}

      {/* chart */}
      <StackedBarChart section={section} demandKey={demandKey} t={t} />

      {/* legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 8 }}>
        {fuelNames.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{
              width: 8, height: 8, borderRadius: 1, flexShrink: 0,
              backgroundColor: matchFuelColor(f), opacity: 0.88,
            }} />
            <span style={{ fontSize: '0.57rem', color: t.lblMuted }}>{f}</span>
          </div>
        ))}
        {hasDemand && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <svg width="14" height="8" style={{ flexShrink: 0 }}>
              <line x1={0} y1={4} x2={14} y2={4}
                stroke={t.lbl} strokeWidth={1.2} strokeDasharray="3,2" opacity={0.7} />
            </svg>
            <span style={{ fontSize: '0.57rem', color: t.lblMuted }}>{demandLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
