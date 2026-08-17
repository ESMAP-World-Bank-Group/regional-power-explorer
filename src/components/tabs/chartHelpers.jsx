// Shared helpers for the country-page tab charts (Supply, Market, …) — kept
// in their own file rather than exported from a tab component so components
// stay Fast-Refresh-friendly (a file mixing component + non-component
// exports breaks Vite's fast refresh for that file).

export function downloadBlob(content, filename, type = 'application/octet-stream') {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Source reliability ───────────────────────────────────────────────────────
export function getSourceMeta(src) {
  if (!src) return { short: '—', rel: null, note: '' };
  const s = src.toLowerCase();
  if (s.includes('entso-e'))                      return { short: 'ENTSO-E',          rel: 'high',   note: 'Official hourly metered data' };
  if (s.includes('eapp'))                         return { short: 'EAPP Secretariat', rel: 'high',   note: 'Official annual interconnection statistics' };
  if (s.includes('teias') || s.includes('epias')) return { short: 'TEIAS/EPIAS',      rel: 'high',   note: 'Official Turkish TSO data' };
  if (s.includes('owid') || s.includes('ember'))  return { short: 'OWID/Ember',       rel: 'medium', note: 'Cross-validated estimates; small countries may be approximate' };
  if (s.includes('comtrade'))                     return { short: 'Comtrade HS 2716', rel: 'medium', note: 'Customs declarations; coverage varies by country' };
  if (s.includes('wdi') || s.includes('world bank')) return { short: 'WB WDI',        rel: 'medium', note: 'Derived from per-capita electricity use × population' };
  // Unknown source: assume it is a named official/national source — show it
  // as-is with no reliability flag (don't claim "Estimated" unless we know it).
  const short = src.split('—')[0].split('(')[0].trim();
  return { short: short.length > 28 ? short.slice(0, 25) + '…' : short, rel: null, note: '' };
}

const _REL_STYLE = {
  high:   { color: '#1A9060', label: 'Official'  },
  medium: { color: '#B87820', label: 'Estimated' },
  low:    { color: '#B84040', label: 'Partial'   },
};

// ── Chart caption: just the source, plus a caveat only when one is worth noting.
// Charts are meant to be self-explanatory; for official sources we show only
// "Source: …". For less-reliable sources (e.g. Comtrade customs data) we add a
// short flag so the reader knows to treat the numbers with care.
export function ChartCaption({ source, t }) {
  const { rel, note } = getSourceMeta(source);
  const flag = (rel && rel !== 'high') ? _REL_STYLE[rel] : null;  // only when not fully reliable
  return (
    <p style={{ margin: '6px 0 0', fontSize: '0.5rem', color: t.lblMuted, lineHeight: 1.45 }}>
      <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '0.44rem', opacity: 0.8 }}>Source </span>
      <span style={{ fontStyle: 'italic' }}>{source || 'Not specified'}</span>
      {flag && (
        <span title={note} style={{
          marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 2,
          fontSize: '0.4rem', padding: '1px 5px', borderRadius: 3,
          background: `${flag.color}18`, color: flag.color, fontWeight: 700, letterSpacing: '0.3px',
        }}>
          <span style={{ fontSize: '0.46rem', lineHeight: 1 }}>●</span>{flag.label}
        </span>
      )}
      {flag && note && (
        <span style={{ display: 'block', marginTop: 2, fontStyle: 'italic', opacity: 0.85, fontSize: '0.46rem' }}>{note}.</span>
      )}
    </p>
  );
}
