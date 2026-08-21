import { useState, useEffect, useMemo, useRef } from 'react';
import { getT } from '../../constants';
import { ChartCaption, downloadBlob } from './chartHelpers';

const SERIES = ['dam', 'idm', 'bpm'];
const SERIES_COLOR = { dam: '#2478B4', idm: '#0E8070', bpm: '#C09010' };
const WHISKER_COLOR = '#B8BEC6'; // light neutral gray, deliberately not the series color — stays out of the way
const GRANULARITIES = [['multiyear', 'Multi-year'], ['year', 'Year'], ['month', 'Month'], ['day', 'Day']];
const SUB_TABS = [['prices', 'Prices']];
// DAM-only — only that series has EUR/USD alternatives in the data (dam_eur, dam_usd).
const CURRENCIES = [['try', 'TL'], ['eur', 'EUR'], ['usd', 'USD']];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// X-axis title — what each granularity's chart points actually represent.
const AXIS_TITLE = { multiyear: 'Year', year: 'Month', month: 'Day', day: 'Hour' };

// All timestamps in the source JSON are UTC (fixed-width ISO strings with a
// "+00:00" suffix), but the daily/monthly/yearly aggregates are bucketed by
// Turkey local time (UTC+3) on the backend — we display everything in UTC via
// plain string slicing regardless, since the hourly points themselves are
// still UTC-stamped; only the daily/monthly/yearly grouping is local-time.
function monthLabel(ym) { const [y, m] = ym.split('-'); return `${MONTH_ABBR[+m - 1]} ${y}`; }
function dayLabel(ymd) { const [y, m, d] = ymd.split('-'); return `${+d} ${MONTH_ABBR[+m - 1]} ${y}`; }
// Full-word versions, used in the chart tooltip (e.g. "4 August 2026").
function fullMonthLabel(ym) { const [y, m] = ym.split('-'); return `${MONTH_FULL[+m - 1]} ${y}`; }
function fullDayLabel(ymd) { const [y, m, d] = ymd.split('-'); return `${+d} ${MONTH_FULL[+m - 1]} ${y}`; }
function hourOfDayLabel(iso) { return `${+iso.slice(11, 13)}:00`; } // "04:00" -> "4:00"
function hourTimestampLabel(iso) {
  const [datePart, timePart] = iso.split('T');
  const [y, m, d] = datePart.split('-');
  return `${+d} ${MONTH_ABBR[+m - 1]} ${y}, ${timePart.slice(0, 5)} UTC`;
}

function fmtPrice(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 1 });
}

function niceTicks(maxVal) {
  if (!maxVal || maxVal <= 0) return [0];
  const raw = maxVal / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].find(f => f * mag >= raw) * mag;
  const ticks = [0];
  for (let v = nice; v <= maxVal + nice; v += nice) ticks.push(Math.round(v));
  return ticks;
}

function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }

// The period nav for a given granularity picks one unit at the level ABOVE
// what gets charted — e.g. picking "2026" (a Year) then charts its months.
function getPeriods(block, granularity) {
  if (!block) return [];
  if (granularity === 'year')  return Object.keys(block.yearly.mean).sort();
  if (granularity === 'month') return Object.keys(block.monthly.mean).sort();
  // Day picks from the rolling hourly window (block.hourly), NOT
  // block.daily.mean — that's permanent full history back to 2017 and would
  // let you "select" days with no hourly detail behind them at all.
  if (granularity === 'day') {
    const days = new Set(Object.keys(block.hourly || {}).map(h => h.slice(0, 10)));
    return [...days].sort();
  }
  return [];
}

function periodOptionLabel(granularity, p) {
  if (granularity === 'year')  return p;
  if (granularity === 'month') return monthLabel(p);
  return dayLabel(p);
}

function computeStats(block, granularity, period) {
  if (!block) return null;
  if (granularity === 'multiyear') {
    const means = Object.values(block.yearly.mean);
    if (!means.length) return null;
    return {
      avg: avg(means),
      min: Math.min(...Object.values(block.yearly.min)),
      max: Math.max(...Object.values(block.yearly.max)),
    };
  }
  if (!period) return null;
  if (granularity === 'year') {
    const keys = Object.keys(block.monthly.mean).filter(k => k.startsWith(`${period}-`));
    if (!keys.length) return null;
    return {
      avg: avg(keys.map(k => block.monthly.mean[k])),
      min: Math.min(...keys.map(k => block.monthly.min[k])),
      max: Math.max(...keys.map(k => block.monthly.max[k])),
    };
  }
  if (granularity === 'month') {
    const keys = Object.keys(block.daily.mean).filter(k => k.startsWith(period));
    if (!keys.length) return null;
    return {
      avg: avg(keys.map(k => block.daily.mean[k])),
      min: Math.min(...keys.map(k => block.daily.min[k])),
      max: Math.max(...keys.map(k => block.daily.max[k])),
    };
  }
  if (granularity === 'day') {
    const hKeys = Object.keys(block.hourly).filter(k => k.startsWith(period));
    if (hKeys.length) {
      const vals = hKeys.map(k => block.hourly[k]);
      return { avg: avg(vals), min: Math.min(...vals), max: Math.max(...vals) };
    }
    // Outside the rolling 90-day hourly window — the daily aggregate is
    // permanent, so we can still show an average even without hourly detail.
    if (block.daily.mean[period] != null) {
      return { avg: block.daily.mean[period], min: block.daily.min[period], max: block.daily.max[period] };
    }
    return null;
  }
  return null;
}

function getChartPoints(block, granularity, period) {
  if (!block) return { mode: 'band', points: [] };
  if (granularity === 'multiyear') {
    const years = Object.keys(block.yearly.mean).sort();
    return { mode: 'band', points: years.map(y => ({
      label: y, fullLabel: y, mean: block.yearly.mean[y], min: block.yearly.min[y], max: block.yearly.max[y],
    })) };
  }
  if (!period) return { mode: 'band', points: [] };
  if (granularity === 'year') {
    const months = Object.keys(block.monthly.mean).filter(k => k.startsWith(`${period}-`)).sort();
    return { mode: 'band', points: months.map(m => ({
      label: MONTH_ABBR[+m.slice(5, 7) - 1], fullLabel: fullMonthLabel(m),
      mean: block.monthly.mean[m], min: block.monthly.min[m], max: block.monthly.max[m],
    })) };
  }
  if (granularity === 'month') {
    const days = Object.keys(block.daily.mean).filter(k => k.startsWith(period)).sort();
    return { mode: 'band', points: days.map(d => ({
      label: `${+d.slice(8, 10)}`, fullLabel: fullDayLabel(d),
      mean: block.daily.mean[d], min: block.daily.min[d], max: block.daily.max[d],
    })) };
  }
  if (granularity === 'day') {
    const hours = Object.keys(block.hourly).filter(k => k.startsWith(period)).sort();
    return { mode: 'line', points: hours.map(h => ({ label: hourOfDayLabel(h), value: block.hourly[h] })) };
  }
  return { mode: 'band', points: [] };
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, unit, sub, t }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 5, backgroundColor: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
      <div style={{ fontSize: '0.5rem', color: t.lblMuted, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: t.lbl, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: '0.56rem', fontWeight: 400, color: t.lblMuted, marginLeft: 3 }}>{unit}</span>}
      </div>
      <div style={{ fontSize: '0.54rem', color: t.lblMuted, marginTop: 4 }}>{sub || ' '}</div>
    </div>
  );
}

// ── Chart: shaded min-max band + mean line (or a plain line for Day) ─────────
function PriceChart({ mode, points, color, unit, t, hoveredI, onHover, xAxisLabel }) {
  const W = 300, H = 168, pL = 42, pR = 8, pT = 10, pB = 30;
  const iW = W - pL - pR, iH = H - pT - pB;
  const n = points.length;
  if (!n) return null;

  const vals = mode === 'band'
    ? points.flatMap(p => [p.mean, p.min, p.max]).filter(v => v != null)
    : points.map(p => p.value).filter(v => v != null);
  const maxVal = Math.max(...vals, 1);
  const ticks   = niceTicks(maxVal);
  const axisMax = ticks[ticks.length - 1] || 1;
  const toY = v => pT + iH - (v / axisMax) * iH;
  const toX = i => n === 1 ? pL + iW / 2 : pL + (i / (n - 1)) * iW;
  const slotW = iW / n;
  // Bars sit centered in their own slot (matching the hover rects below);
  // the Day line chart keeps the edge-to-edge toX spread instead.
  const barW    = Math.max(slotW * 0.55, 1.5);
  const barX    = i => pL + i * slotW + (slotW - barW) / 2;
  const slotMid = i => pL + i * slotW + slotW / 2;
  const xPos    = i => mode === 'band' ? slotMid(i) : toX(i);

  let linePts = null;
  if (mode !== 'band') {
    linePts = points.map((p, i) => p.value != null ? `${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}` : null).filter(Boolean).join(' ');
  }

  const labelStep = n > 20 ? Math.ceil(n / 10) : n > 10 ? 2 : 1;
  const hlFill = t.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const whiskerCapW = barW * 0.55;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      <text transform={`translate(9,${pT + iH / 2}) rotate(-90)`} textAnchor="middle" fill={t.lblMuted} fontSize={6}>{unit}</text>
      {ticks.map(tick => (
        <g key={tick}>
          {tick > 0 && <line x1={pL} x2={pL + iW} y1={toY(tick)} y2={toY(tick)} stroke={t.panelBorder} strokeWidth={0.4} strokeDasharray="2,3" />}
          <text x={pL - 3} y={toY(tick) + 3} textAnchor="end" fill={t.lblMuted} fontSize={6.5}>{fmtPrice(tick)}</text>
        </g>
      ))}
      <line x1={pL} x2={pL} y1={pT} y2={pT + iH} stroke={t.lblMuted} strokeWidth={0.4} />
      <line x1={pL} x2={pL + iW} y1={pT + iH} y2={pT + iH} stroke={t.lblMuted} strokeWidth={0.4} />

      {hoveredI != null && <rect x={pL + hoveredI * slotW} y={pT} width={slotW} height={iH} fill={hlFill} />}

      {mode === 'band' && points.map((p, i) => p.mean == null ? null : (
        <rect key={`bar${i}`} x={barX(i)} y={toY(p.mean)} width={barW}
          height={Math.max(pT + iH - toY(p.mean), 0.5)} fill={color} opacity={hoveredI === i ? 1 : 0.85} />
      ))}
      {mode === 'band' && points.map((p, i) => {
        if (p.min == null || p.max == null) return null;
        const cx = slotMid(i);
        const yMin = toY(p.min), yMax = toY(p.max);
        return (
          <g key={`wh${i}`}>
            <line x1={cx} x2={cx} y1={yMax} y2={yMin} stroke={WHISKER_COLOR} strokeWidth={0.7} />
            <line x1={cx - whiskerCapW / 2} x2={cx + whiskerCapW / 2} y1={yMax} y2={yMax} stroke={WHISKER_COLOR} strokeWidth={0.7} />
            <line x1={cx - whiskerCapW / 2} x2={cx + whiskerCapW / 2} y1={yMin} y2={yMin} stroke={WHISKER_COLOR} strokeWidth={0.7} />
          </g>
        );
      })}
      {mode === 'line' && linePts && <polyline points={linePts} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />}

      {points.map((p, i) => i % labelStep === 0 && (
        <text key={i} x={xPos(i)} y={pT + iH + 9} textAnchor="middle" fill={hoveredI === i ? t.lbl : t.lblMuted} fontSize={5.8}>{p.label}</text>
      ))}

      {xAxisLabel && (
        <text x={pL + iW / 2} y={pT + iH + 19} textAnchor="middle" fill={t.lblMuted} fontSize={6} fontStyle="italic">
          {xAxisLabel}
        </text>
      )}

      {points.map((p, i) => (
        <rect key={`h${i}`} x={pL + i * slotW} y={pT} width={slotW} height={iH}
          fill="transparent" style={{ cursor: 'default' }}
          onMouseEnter={e => onHover(i, e)} onMouseLeave={() => onHover(null, null)} />
      ))}
    </svg>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function MarketTab({ iso, theme }) {
  const t = getT(theme);

  const [subTab,       setSubTab]      = useState('prices');
  const [data,        setData]        = useState(null);
  const [loading,      setLoading]     = useState(true);
  const [series,       setSeries]      = useState('dam');
  const [currency,     setCurrency]    = useState('try'); // 'try' | 'eur' | 'usd' — DAM only, remembered across series switches
  const [granularity,  setGranularity] = useState('multiyear');
  const [period,       setPeriod]      = useState(null);
  const [tip,          setTip]         = useState(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!iso) return;
    setLoading(true); setData(null);
    setSeries('dam'); setCurrency('try'); setGranularity('multiyear'); setPeriod(null); setTip(null);
    fetch(`/data/market/${iso}.json`)
      .then(r => { if (!r.ok) throw new Error('404'); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [iso]);

  // dam_eur / dam_usd are separate top-level keys with the same shape as dam
  // (and their own unit) — idm/bpm have no currency alternatives, so this
  // only kicks in for series === 'dam'.
  const dataKey = series === 'dam' && currency !== 'try' ? `dam_${currency}` : series;
  const block = data?.[dataKey] ?? null;

  const periods = useMemo(() => getPeriods(block, granularity), [block, granularity]);

  // Default to the most recent period whenever granularity changes (previous
  // period format won't match, so this always resets); on a series switch
  // with the same granularity it stays put as long as it's still valid.
  useEffect(() => {
    if (granularity === 'multiyear') { setPeriod(null); return; }
    if (!periods.length) { setPeriod(null); return; }
    setPeriod(prev => periods.includes(prev) ? prev : periods[periods.length - 1]);
  }, [periods, granularity]);

  const stats       = useMemo(() => computeStats(block, granularity, period), [block, granularity, period]);
  const chartPoints = useMemo(() => getChartPoints(block, granularity, period), [block, granularity, period]);
  const years        = useMemo(() => block ? Object.keys(block.yearly.mean).sort() : [], [block]);
  const latestHourly = useMemo(() => {
    if (!block?.hourly) return null;
    const keys = Object.keys(block.hourly);
    if (!keys.length) return null;
    const latestKey = keys.reduce((a, b) => (a > b ? a : b));
    return { ts: latestKey, value: block.hourly[latestKey] };
  }, [block]);

  if (loading) return <p style={{ fontSize: '0.7rem', color: t.lblMuted, marginTop: 8 }}>Loading…</p>;
  if (!data)   return <p style={{ fontSize: '0.7rem', color: t.lblMuted, marginTop: 8, fontStyle: 'italic' }}>No market data available for this country.</p>;

  const unit = block?.unit || 'TL/MWh';
  const periodIdx = periods.indexOf(period);

  // Underline-style sub-tabs (a tab strip, not standalone pill buttons) —
  // reads as a tab set even with just one entry, and more (e.g.
  // "Consumption") can be added to SUB_TABS without restyling.
  const subTabBtnStyle = active => ({
    fontSize: '0.56rem', letterSpacing: '0.5px', textTransform: 'uppercase', fontWeight: active ? 700 : 400,
    padding: '0 2px 7px', cursor: 'pointer', fontFamily: 'inherit',
    background: 'none', border: 'none', borderBottom: `2px solid ${active ? 'rgba(74,143,204,0.9)' : 'transparent'}`,
    color: active ? t.lbl : t.lblMuted,
  });

  const toggleBtnStyle = active => ({
    fontSize: '0.55rem', letterSpacing: '0.5px', textTransform: 'uppercase',
    padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${active ? 'rgba(74,143,204,0.6)' : t.panelBorder}`,
    backgroundColor: active ? 'rgba(74,143,204,0.1)' : 'transparent',
    color: active ? t.lbl : t.lblMuted,
  });

  const navBtnStyle = disabled => ({
    fontSize: '0.7rem', width: 20, height: 20, lineHeight: '18px', textAlign: 'center',
    borderRadius: 3, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
    border: `1px solid ${t.panelBorder}`, backgroundColor: 'transparent',
    color: disabled ? t.panelBorder : t.lblMuted, padding: 0, opacity: disabled ? 0.5 : 1, flexShrink: 0,
  });

  const dlBtnStyle = {
    fontSize: '0.52rem', letterSpacing: '0.5px', padding: '4px 9px', borderRadius: 3,
    cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${t.panelBorder}`,
    backgroundColor: 'transparent', color: t.lblMuted,
  };

  const goPrev = () => { if (periodIdx > 0) setPeriod(periods[periodIdx - 1]); };
  const goNext = () => { if (periodIdx >= 0 && periodIdx < periods.length - 1) setPeriod(periods[periodIdx + 1]); };

  const handleHover = (i, e) => {
    if (i === null) { setTip(null); return; }
    if (!chartRef.current) return;
    const r = chartRef.current.getBoundingClientRect();
    setTip({ i, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const handleDownload = () => {
    if (!block) return;
    const days = Object.keys(block.daily.mean).sort();
    const header = 'date,mean,min,max';
    const rows = days.map(d => [d, block.daily.mean[d], block.daily.min[d], block.daily.max[d]].join(','));
    downloadBlob([header, ...rows].join('\n'), `market_${dataKey}_daily_${iso}.csv`, 'text/csv');
  };

  const kpi1Label = granularity === 'multiyear'
    ? `Average${years.length ? ` · ${years[0]}–${years[years.length - 1]}` : ''}`
    : granularity === 'year'  ? `Average · ${period ?? ''}`
    : granularity === 'month' ? `Average · ${period ? monthLabel(period) : ''}`
    : `Average · ${period ? dayLabel(period) : ''}`;

  const noHourlyDetail = granularity === 'day' && period && chartPoints.points.length === 0;

  const tooltip = (() => {
    if (!tip) return null;
    const p = chartPoints.points[tip.i];
    if (!p) return null;
    const TW = 148;
    const left = tip.x > 170 ? tip.x - TW - 6 : tip.x + 8;
    const top  = Math.max(tip.y - 30, 0);
    const dateLine = chartPoints.mode === 'band' ? p.fullLabel : (period ? fullDayLabel(period) : p.label);
    const row = (label, value, muted) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: muted ? '0.52rem' : '0.55rem', color: muted ? t.lblMuted : t.lbl }}>
        <span style={{ color: t.lblMuted }}>{label}</span>
        <span>{value} <span style={{ fontSize: '0.46rem', color: t.lblMuted }}>{unit}</span></span>
      </div>
    );
    return (
      <div style={{
        position: 'absolute', left, top, width: TW, pointerEvents: 'none', zIndex: 10,
        backgroundColor: t.panel, border: `1px solid ${t.panelBorder}`,
        borderRadius: 4, padding: '6px 8px', boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.56rem', color: t.lbl, marginBottom: 3 }}>
          <span style={{ fontWeight: 400, color: t.lblMuted }}>Date: </span>{dateLine}
        </div>
        {chartPoints.mode === 'band' ? (
          <>
            {row('Mean', fmtPrice(p.mean))}
            {row('Min', fmtPrice(p.min), true)}
            {row('Max', fmtPrice(p.max), true)}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.52rem', color: t.lblMuted, marginBottom: 2 }}>
              <span>Hour</span><span>{p.label}</span>
            </div>
            {row('Price', fmtPrice(p.value))}
          </>
        )}
      </div>
    );
  })();

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14, borderBottom: `1px solid ${t.panelBorder}` }}>
        {SUB_TABS.map(([id, lbl]) => (
          <button key={id} onClick={() => setSubTab(id)} style={subTabBtnStyle(subTab === id)}>{lbl}</button>
        ))}
      </div>

      {subTab === 'prices' && (
        <>
          {/* Series toggle — full dataset name, 2 lines, slightly narrower than the panel, centered */}
          <div style={{ display: 'flex', gap: 4, width: '93%', margin: '0 auto 10px' }}>
            {SERIES.map(s => {
              const [line1, line2 = ''] = (data[s]?.label || s.toUpperCase()).split(' — ');
              const active = series === s;
              return (
                <button key={s} onClick={() => { setSeries(s); setTip(null); }} style={{
                  flex: 1, padding: '7px 4px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${active ? 'rgba(74,143,204,0.6)' : t.panelBorder}`,
                  backgroundColor: active ? 'rgba(74,143,204,0.1)' : 'transparent',
                  textAlign: 'center', lineHeight: 1.3,
                }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: active ? t.lbl : t.lblMuted }}>{line1}</div>
                  <div style={{ fontSize: '0.58rem', fontWeight: 400, color: t.lblMuted, marginTop: 2 }}>{line2}</div>
                </button>
              );
            })}
          </div>

          {/* Granularity toggle */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {GRANULARITIES.map(([g, lbl]) => (
              <button key={g} onClick={() => { setGranularity(g); setTip(null); }}
                style={toggleBtnStyle(granularity === g)}>{lbl}</button>
            ))}
          </div>

          {/* Period nav */}
          {granularity !== 'multiyear' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <button onClick={goPrev} disabled={periodIdx <= 0} style={navBtnStyle(periodIdx <= 0)}>‹</button>
              <select
                value={period ?? ''}
                onChange={e => { setPeriod(e.target.value); setTip(null); }}
                style={{
                  flex: 1, fontSize: '0.6rem', padding: '3px 6px', borderRadius: 4, fontFamily: 'inherit',
                  border: `1px solid ${t.panelBorder}`, backgroundColor: t.panel, color: t.lbl, outline: 'none',
                }}
              >
                {periods.map(p => <option key={p} value={p}>{periodOptionLabel(granularity, p)}</option>)}
              </select>
              <button onClick={goNext} disabled={periodIdx < 0 || periodIdx >= periods.length - 1}
                style={navBtnStyle(periodIdx < 0 || periodIdx >= periods.length - 1)}>›</button>
            </div>
          )}

          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
            <KpiCard label={kpi1Label} value={fmtPrice(stats?.avg)} unit={unit}
              sub={stats ? `Min ${fmtPrice(stats.min)} · Max ${fmtPrice(stats.max)}` : 'No data'} t={t} />
            <KpiCard label="Latest Price" value={fmtPrice(latestHourly?.value)} unit={unit}
              sub={latestHourly ? hourTimestampLabel(latestHourly.ts) : 'No data'} t={t} />
          </div>

          {/* Currency toggle — DAM only, IDM/BPM have no EUR/USD in the data */}
          {series === 'dam' && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {CURRENCIES.map(([c, lbl]) => (
                <button key={c} onClick={() => setCurrency(c)} style={toggleBtnStyle(currency === c)}>{lbl}</button>
              ))}
            </div>
          )}

          {/* Chart */}
          {noHourlyDetail ? (
            <p style={{ fontSize: '0.62rem', color: t.lblMuted, fontStyle: 'italic', padding: '24px 8px', textAlign: 'center', lineHeight: 1.5 }}>
              No hourly detail available for {dayLabel(period)} — outside the rolling 90-day window.
              The average above is still accurate; only the hour-by-hour chart is unavailable.
            </p>
          ) : chartPoints.points.length ? (
            <div ref={chartRef} style={{ position: 'relative' }}>
              <PriceChart mode={chartPoints.mode} points={chartPoints.points} color={SERIES_COLOR[series]}
                unit={unit} t={t} hoveredI={tip?.i ?? null} onHover={handleHover} xAxisLabel={AXIS_TITLE[granularity]} />
              {tooltip}
            </div>
          ) : (
            <p style={{ fontSize: '0.62rem', color: t.lblMuted, fontStyle: 'italic', padding: '12px 0' }}>No data for this period.</p>
          )}

          <ChartCaption source={data.source} t={t} />

          {/* CSV download */}
          <div style={{ marginTop: 16, borderTop: `1px solid ${t.panelBorder}`, paddingTop: 12 }}>
            <span style={{ fontSize: '0.47rem', letterSpacing: '2px', fontWeight: 700, color: t.lblMuted, textTransform: 'uppercase', display: 'block', marginBottom: 7 }}>
              Export Data
            </span>
            <button style={dlBtnStyle} onClick={handleDownload}>{series.toUpperCase()} daily CSV</button>
          </div>
        </>
      )}
    </div>
  );
}
