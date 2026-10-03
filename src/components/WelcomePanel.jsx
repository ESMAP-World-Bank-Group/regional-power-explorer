import { useEffect } from 'react';
import { rememberWelcomeSeen } from '../utils/welcome';

/**
 * What the explorer is and how to start, shown over the world map on a first
 * visit. The map keeps loading behind it, so the basemap's round trips to
 * ArcGIS are mostly done by the time it is dismissed.
 */
export default function WelcomePanel({ t, onClose }) {
  const close = () => { rememberWelcomeSeen(); onClose(); };

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div onClick={close} style={{
      position: 'absolute', inset: 0, zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(20,35,55,0.25)',
      padding: 16,
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="welcome-title"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          backgroundColor: t.panel, border: `1px solid ${t.panelBorder}`,
          borderRadius: 10, padding: '22px 24px 20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)', color: t.text,
        }}>
        <h2 id="welcome-title" style={{ margin: '0 0 10px', fontSize: '1.05rem', fontWeight: 700, color: t.lbl }}>
          Regional Power Explorer
        </h2>
        <p style={{ margin: '0 0 10px', fontSize: '0.8rem', lineHeight: 1.5 }}>
          Explore power systems across regional power pools: generation capacity,
          transmission lines, cross-border trade and planning zones.
        </p>
        <p style={{ margin: '0 0 14px', fontSize: '0.8rem', lineHeight: 1.5 }}>
          <strong>Click a region</strong> on the map to open it, then a country for details.
          Switch plant sources, filter by fuel or voltage, and download what you see.
        </p>
        <p style={{ margin: '0 0 18px', fontSize: '0.66rem', lineHeight: 1.45, color: t.muted, fontStyle: 'italic' }}>
          The boundaries, colors, denominations and other information shown on this map do not
          imply any judgment on the part of the World Bank concerning the legal status of any
          territory or the endorsement or acceptance of such boundaries.
        </p>
        <button autoFocus onClick={close} style={{
          width: '100%', padding: '9px 14px', cursor: 'pointer',
          fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
          color: t.panel, backgroundColor: t.lbl,
          border: 'none', borderRadius: 6,
        }}>
          Explore the map
        </button>
      </div>
    </div>
  );
}
