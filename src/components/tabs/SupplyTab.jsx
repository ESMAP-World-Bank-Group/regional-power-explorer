import { useState, useEffect, useRef } from 'react';
import { FUEL_COLORS, getT } from '../../constants';

function matchFuelColor(name) {
  const n = name.toLowerCase();
  if (n.includes('coal'))                           return FUEL_COLORS.coal;
  if (n.includes('gas'))                            return FUEL_COLORS.gas;
  if (n.includes('hydro'))                          return FUEL_COLORS.hydro;
  if (n.includes('solar'))                          return FUEL_COLORS.solar;
  if (n.includes('geothermal'))                     return FUEL_COLORS.geothermal;
  if (n.includes('wind'))                           return FUEL_COLORS.wind;
  if (n.includes('nuclear'))                        return FUEL_COLORS.nuclear;
  if (n.includes('oil'))                            return FUEL_COLORS.oil;
  if (n.includes('biomass') || n.includes('wood'))  return FUEL_COLORS.biomass;
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

const fmt = v =>
  v == null ? '—'
  : v >= 1e6  ? `${(v / 1e6).toFixed(1)}M`
  : v >= 1000 ? `${(v / 1000).toFixed(0)}k`
  : v.toFixed(1);

function StackedBarChart({ section, demandKey, hiddenFuels, hoveredYi, onColHover, t }) {
  const W = 300, H = 185, pL = 40, pR = 6, pT = 8, pB = 28;
  const iW = W - pL - pR, iH = H - pT - pB;

  const { years, fuels, unit } = section;
  const demand     = section[demandKey] || [];
  const allFuels   = Object.keys(fuels);
  const visFuels   = allFuels.filter(f => !hiddenFuels.has(f));

  const totals     = years.map((_, yi) => visFuels.reduce((s, f) => s + (fuels[f][yi] ?? 0), 0));
  const demandVals = demand.filter(v => v != null);
  const maxVal     = Math.max(...totals, demandVals.length ? Math.max(...demandVals) : 0, 1);

  const ticks  = niceTicks(maxVal);
  const axisMax = ticks[ticks.length - 1] || 1;
  const toY    = v => pT + iH - (v / axisMax) * iH;
  const slotW  = iW / years.length;
  const barW   = Math.max(slotW * 0.76, 1.5);
  const barX   = i => pL + i * slotW + (slotW - barW) / 2;

  const dPts = demand
    .map((v, i) => v != null ? `${(barX(i) + barW / 2).toFixed(1)},${toY(v).toFixed(1)}` : null)
    .filter(Boolean).join(' ');

  const yrStep = years.length > 15 ? 5 : years.length > 8 ? 2 : 1;
  const hlFill = t.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* Y-axis label */}
      <text transform={`translate(8,${pT + iH / 2}) rotate(-90)`}
        textAnchor="middle" fill={t.lblMuted} fontSize={6}>{unit}</text>

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

      {/* columns */}
      {years.map((yr, yi) => {
        let base = 0;
        const x = barX(yi);
        return (
          <g key={yr}>
            {/* hover highlight behind bars */}
            {hoveredYi === yi && (
              <rect x={pL + yi * slotW} y={pT} width={slotW} height={iH} fill={hlFill} />
            )}

            {/* stacked fuel rects */}
            {allFuels.map(f => {
              if (hiddenFuels.has(f)) return null;
              const v = fuels[f][yi] ?? 0;
              if (v <= 0) return null;
              const h = (v / axisMax) * iH;
              const y = toY(base + v);
              base += v;
              return (
                <rect key={f} x={x} y={y} width={barW} height={Math.max(h, 0.3)}
                  fill={matchFuelColor(f)} opacity={hoveredYi === yi ? 1 : 0.88} />
              );
            })}

            {/* year label */}
            {yr % yrStep === 0 && (
              <text x={x + barW / 2} y={pT + iH + 9} textAnchor="middle"
                fill={hoveredYi === yi ? t.lbl : t.lblMuted} fontSize={5.8}>{yr}</text>
            )}

            {/* transparent hover capture rect */}
            <rect
              x={pL + yi * slotW} y={pT} width={slotW} height={iH}
              fill="transparent" style={{ cursor: 'default' }}
              onMouseEnter={e => onColHover(yi, e)}
              onMouseLeave={() => onColHover(null, null)}
            />
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
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [view,        setView]        = useState('generation');
  const [hiddenFuels, setHiddenFuels] = useState(new Set());
  const [tooltip,     setTooltip]     = useState(null); // { yi, x, y }
  const chartRef = useRef(null);

  useEffect(() => {
    if (!iso) return;
    setLoading(true);
    setData(null);
    fetch(`/data/supply/${iso}.json`)
      .then(r => { if (!r.ok) throw new Error('404'); return r.json(); })
      .then(d  => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [iso]);

  if (loading) return <p style={{ fontSize: '0.7rem', color: t.lblMuted, marginTop: 8 }}>Loading…</p>;
  if (!data)   return (
    <p style={{ fontSize: '0.7rem', color: t.lblMuted, marginTop: 8, fontStyle: 'italic' }}>
      No supply data available for this country.
    </p>
  );

  const section      = view === 'generation' ? data.generation : data.capacity;
  const demandKey    = view === 'generation' ? 'demand' : 'peak_demand';
  const demandLabel  = view === 'generation' ? 'Demand (grid)' : 'Peak demand';
  const allFuels     = Object.keys(section.fuels);
  const hasDemand    = (section[demandKey] || []).some(v => v != null);

  const toggleFuel = f => {
    setHiddenFuels(prev => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  };

  const handleColHover = (yi, e) => {
    if (yi === null) { setTooltip(null); return; }
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    setTooltip({ yi, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Build tooltip content
  const ttData = tooltip !== null ? (() => {
    const yi    = tooltip.yi;
    const yr    = section.years[yi];
    const visFuels = allFuels.filter(f => !hiddenFuels.has(f));
    const rows  = visFuels
      .map(f => ({ f, v: section.fuels[f][yi] ?? 0 }))
      .filter(r => r.v > 0);
    const total = rows.reduce((s, r) => s + r.v, 0);
    const dVal  = (section[demandKey] || [])[yi];
    return { yr, rows, total, dVal };
  })() : null;

  return (
    <div>
      {/* toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {[['generation', 'Generation'], ['capacity', 'Capacity']].map(([v, lbl]) => (
          <button key={v} onClick={() => { setView(v); setHiddenFuels(new Set()); setTooltip(null); }} style={{
            fontSize: '0.47rem', letterSpacing: '0.5px', textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${view === v ? 'rgba(74,143,204,0.6)' : t.panelBorder}`,
            backgroundColor: view === v ? 'rgba(74,143,204,0.1)' : 'transparent',
            color: view === v ? t.lbl : t.lblMuted,
          }}>{lbl}</button>
        ))}
      </div>

      {/* chart + legend side-by-side */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>

        {/* chart */}
        <div ref={chartRef} style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <StackedBarChart
            section={section} demandKey={demandKey} t={t}
            hiddenFuels={hiddenFuels}
            hoveredYi={tooltip?.yi ?? null}
            onColHover={handleColHover}
          />

          {/* tooltip */}
          {ttData && (() => {
            const TW = 120;
            const left = tooltip.x > 140 ? tooltip.x - TW - 6 : tooltip.x + 8;
            const top  = Math.max(tooltip.y - 30, 0);
            return (
              <div style={{
                position: 'absolute', left, top,
                width: TW, pointerEvents: 'none', zIndex: 10,
                backgroundColor: t.panel,
                border: `1px solid ${t.panelBorder}`,
                borderRadius: 4, padding: '6px 8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              }}>
                <div style={{ fontWeight: 700, fontSize: '0.65rem', color: t.lbl, marginBottom: 4 }}>
                  {ttData.yr}
                  <span style={{ fontWeight: 400, color: t.lblMuted, marginLeft: 6 }}>
                    {fmt(ttData.total)} {section.unit}
                  </span>
                </div>
                {ttData.rows.map(({ f, v }) => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <div style={{ width: 6, height: 6, borderRadius: 1, flexShrink: 0, backgroundColor: matchFuelColor(f) }} />
                    <span style={{ fontSize: '0.55rem', color: t.lblMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
                    <span style={{ fontSize: '0.58rem', color: t.lbl, flexShrink: 0 }}>{fmt(v)}</span>
                  </div>
                ))}
                {ttData.dVal != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, paddingTop: 4, borderTop: `1px solid ${t.panelBorder}` }}>
                    <svg width="10" height="6" style={{ flexShrink: 0 }}>
                      <line x1={0} y1={3} x2={10} y2={3} stroke={t.lbl} strokeWidth={1.2} strokeDasharray="2,1.5" opacity={0.7} />
                    </svg>
                    <span style={{ fontSize: '0.55rem', color: t.lblMuted, flex: 1 }}>{demandLabel}</span>
                    <span style={{ fontSize: '0.58rem', color: t.lbl, flexShrink: 0 }}>{fmt(ttData.dVal)}</span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* legend — right column */}
        <div style={{ flexShrink: 0, width: 72, display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 10 }}>
          {allFuels.map(f => {
            const hidden = hiddenFuels.has(f);
            return (
              <button key={f} onClick={() => toggleFuel(f)} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', padding: 0,
                cursor: 'pointer', opacity: hidden ? 0.35 : 1, textAlign: 'left',
              }}>
                <div style={{ width: 7, height: 7, borderRadius: 1, flexShrink: 0, backgroundColor: matchFuelColor(f), opacity: 0.88, position: 'relative' }}>
                  {hidden && (
                    <svg style={{ position: 'absolute', top: -1, left: -1 }} width={9} height={9}>
                      <line x1={1} y1={8} x2={8} y2={1} stroke={t.lbl} strokeWidth={1.2} />
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: '0.54rem', color: hidden ? t.lblMuted : t.lbl, textDecoration: hidden ? 'line-through' : 'none', lineHeight: 1.2 }}>{f}</span>
              </button>
            );
          })}
          {hasDemand && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <svg width="12" height="7" style={{ flexShrink: 0 }}>
                <line x1={0} y1={3.5} x2={12} y2={3.5} stroke={t.lbl} strokeWidth={1.2} strokeDasharray="3,2" opacity={0.7} />
              </svg>
              <span style={{ fontSize: '0.54rem', color: t.lblMuted, lineHeight: 1.2 }}>{demandLabel}</span>
            </div>
          )}
        </div>
      </div>

      {/* source + note below chart */}
      <p style={{ fontSize: '0.55rem', color: t.lblMuted, margin: '6px 0 0', opacity: 0.75 }}>{section.source}</p>
      {section.note && (
        <p style={{ fontSize: '0.53rem', color: t.lblMuted, fontStyle: 'italic', margin: '2px 0 0', opacity: 0.7 }}>
          {section.note}
        </p>
      )}
    </div>
  );
}
