import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../App';
import { getT, THEME_LIST, THEMES } from '../constants';
import { useEffect, useState, useMemo } from 'react';
import { track } from '../analytics';

const EPM_DASHBOARD_URL = 'https://epm-data-explorer.vercel.app';

// Countries and regions with published EPM models in epm-data-explorer
const EPM_ISOS = new Set([
  'ARM','AZE','BGR','GEO','ROU','TUR',                          // Black Sea
  'EGY','SDN','SSD','ETH','DJI','KEN','TZA','UGA','RWA','BDI','COD','SOM', // EAPP
  'ZAF','ZWE','ZMB','BWA','MOZ','MWI','NAM','LSO','SWZ','AGO','MDG',        // SAPP
]);
const EPM_REGIONS = new Set(['blacksea', 'eapp', 'sapp']);

function useBreadcrumb() {
  const location = useLocation();
  const [label, setLabel] = useState('');

  useEffect(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length === 0) { setLabel(''); return; }
    if (parts[0] === 'region' && parts[1]) {
      fetch('/data/regions.json')
        .then(r => r.json())
        .then(d => {
          const r = (d.regions || []).find(r => r.id === parts[1]);
          setLabel(r ? r.name : parts[1]);
        })
        .catch(() => setLabel(parts[1]));
    } else if (parts[0] === 'country' && parts[1]) {
      fetch('/data/regions.json')
        .then(r => r.json())
        .then(d => {
          for (const r of (d.regions || [])) {
            const c = r.countries.find(c => c.iso === parts[1]);
            if (c) { setLabel(`${r.name} / ${c.name}`); return; }
          }
          setLabel(parts[1]);
        })
        .catch(() => setLabel(parts[1]));
    }
  }, [location.pathname]);

  return label;
}

export default function Navbar() {
  const { theme, setTheme } = useTheme();
  const t = getT(theme);
  const crumb = useBreadcrumb();
  const location = useLocation();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [epmCountryPath, setEpmCountryPath] = useState(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 700);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 700);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Resolve EPM path from ISO: /country/AZE → /region/black_sea/country/Azerbaijan
  useEffect(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'country' || !parts[1]) { setEpmCountryPath(null); return; }
    const iso = parts[1];
    fetch('/data/regions.json')
      .then(r => r.json())
      .then(d => {
        for (const r of (d.regions || [])) {
          const c = (r.countries || []).find(c => c.iso === iso);
          if (c) { setEpmCountryPath(`/region/${r.id}/country/${encodeURIComponent(c.name)}`); return; }
        }
        setEpmCountryPath(null);
      })
      .catch(() => setEpmCountryPath(null));
  }, [location.pathname]);

  const dashboardUrl = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    const suffix = `?theme=${theme}`;
    if (parts[0] === 'region' && parts[1]) return `${EPM_DASHBOARD_URL}/region/${parts[1]}${suffix}`;
    if (parts[0] === 'country' && parts[1]) {
      if (epmCountryPath) return `${EPM_DASHBOARD_URL}${epmCountryPath}${suffix}`;
      return `${EPM_DASHBOARD_URL}/country/${parts[1]}${suffix}`;
    }
    return `${EPM_DASHBOARD_URL}${suffix}`;
  }, [location.pathname, theme, epmCountryPath]);

  const epmAvailable = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'country' && parts[1]) return EPM_ISOS.has(parts[1]);
    if (parts[0] === 'region' && parts[1]) return EPM_REGIONS.has(parts[1]);
    return true;
  }, [location.pathname]);

  const navBtn = (active = false) => ({
    background: 'none',
    border: `1px solid ${active ? 'rgba(128,160,192,0.5)' : t.panelBorder}`,
    borderRadius: 5, padding: '3px 10px',
    cursor: 'pointer',
    color: active ? t.lbl : t.lblMuted,
    fontSize: '0.68rem', letterSpacing: '1px',
    textTransform: 'uppercase', fontFamily: 'inherit',
    textDecoration: 'none',
    display: 'inline-flex', alignItems: 'center',
    transition: 'border-color 0.2s, color 0.2s',
  });

  return (
    <div style={{
      height: 46, display: 'flex', alignItems: 'center',
      padding: '0 18px', backgroundColor: t.navBg,
      borderBottom: `1px solid ${t.panelBorder}`,
      justifyContent: 'space-between', flexShrink: 0,
      zIndex: 200,
    }}>

      {/* Left: logo + breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Link to="/" style={{
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '2px',
          color: t.muted, textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/>
            <ellipse cx="12" cy="12" rx="4.5" ry="10"/>
            <line x1="2.5" y1="9" x2="21.5" y2="9"/>
            <line x1="2.5" y1="15" x2="21.5" y2="15"/>
          </svg>
          {isMobile
            ? <span style={{ fontWeight: 400 }}>Explorer</span>
            : <>Regional Power <span style={{ fontWeight: 400 }}>Explorer</span></>
          }
        </Link>
        {!isMobile && (
          <span style={{
            fontSize: '0.48rem', fontWeight: 700, letterSpacing: '1.5px',
            color: 'rgba(74,143,204,0.7)', textTransform: 'uppercase',
            border: '1px solid rgba(74,143,204,0.3)', borderRadius: 3,
            padding: '1px 5px', lineHeight: 1,
          }}>
            Beta
          </span>
        )}
        {crumb && (
          <>
            <span style={{ color: t.panelBorder, fontSize: '0.75rem' }}>›</span>
            <span style={{ fontSize: '0.75rem', color: t.lbl, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{crumb}</span>
          </>
        )}
      </div>

      {/* Center: hint — desktop only */}
      {!isMobile && (
        <div style={{ flex: 1, textAlign: 'center', pointerEvents: 'none' }}>
          <span style={{
            fontStyle: 'italic', fontSize: '0.6rem', letterSpacing: '0.25px',
            color: t.navHint,
          }}>
            Click a region or country to explore &nbsp;·&nbsp; click a legend to filter the map
          </span>
        </div>
      )}

      {/* Right: theme toggle | EPM Suite | Data Sources | Contact */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>

        {/* Theme swatches */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginRight: 2 }}>
          {THEME_LIST.map(id => {
            const th = THEMES[id];
            const active = theme === id;
            return (
              <button key={id} title={th.label} onClick={() => setTheme(id)} style={{
                width: 15, height: 15, borderRadius: '50%', padding: 0, cursor: 'pointer',
                backgroundColor: th.swatch,
                border: active ? `2px solid ${t.lbl}` : `1px solid ${t.panelBorder}`,
                boxShadow: active ? '0 0 0 1px rgba(128,160,192,0.35)' : 'none',
                transform: active ? 'scale(1.25)' : 'scale(1)',
                transition: 'transform 0.15s, box-shadow 0.15s',
                flexShrink: 0,
              }} />
            );
          })}
        </div>

        {/* EPM View — desktop only */}
        {!isMobile && (
          <div style={{ position: 'relative' }}>
            <a
              href={epmAvailable ? dashboardUrl : undefined}
              onMouseEnter={() => setTooltipVisible(true)}
              onMouseLeave={() => setTooltipVisible(false)}
              style={{
                ...navBtn(),
                color: epmAvailable ? 'rgba(74,143,204,0.9)' : t.lblMuted,
                border: `1px solid ${epmAvailable ? 'rgba(74,143,204,0.45)' : t.panelBorder}`,
                gap: 6,
                cursor: epmAvailable ? 'pointer' : 'default',
                opacity: epmAvailable ? 1 : 0.5,
              }}
              onMouseOver={e => { if (epmAvailable) e.currentTarget.style.background = 'rgba(74,143,204,0.07)'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'none'; setTooltipVisible(false); }}
              onClick={() => { if (epmAvailable) track('epm_view_click', { from: location.pathname }); }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              EPM View
            </a>

            {tooltipVisible && (
              <div style={{
                position: 'absolute', top: 36, right: 0, zIndex: 300,
                backgroundColor: t.panel, border: `1px solid ${t.panelBorder}`,
                borderRadius: 6, padding: '10px 14px', width: 220,
                fontSize: '0.68rem', color: t.muted,
                boxShadow: '0 4px 16px rgba(0,0,0,0.18)', lineHeight: 1.6,
                pointerEvents: 'none',
              }}>
                {epmAvailable ? (
                  <span style={{ color: t.lbl, fontWeight: 600, display: 'block' }}>
                    EPM View · Capacity Expansion Results
                  </span>
                ) : (
                  <>
                    <span style={{ color: t.lbl, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      EPM model not published yet
                    </span>
                    <span style={{ fontStyle: 'italic' }}>
                      No EPM results available for this country or region.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Data Sources — desktop only */}
        {!isMobile && (
          <Link to="/about" style={navBtn(location.pathname === '/about')}>
            Data Sources
          </Link>
        )}

        {/* About — desktop only */}
        {!isMobile && (
          <Link to="/contact" style={navBtn(location.pathname === '/contact')}>
            About
          </Link>
        )}

      </div>
    </div>
  );
}
