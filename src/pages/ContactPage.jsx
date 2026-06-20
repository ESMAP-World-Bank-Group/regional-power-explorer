import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../App';
import { getT } from '../constants';

const FORMSPREE_ID = 'mlgkpwav';

function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      color: 'rgba(74,143,204,0.88)', textDecoration: 'none',
    }}
      onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'}
      onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}
    >
      {children}
    </a>
  );
}

function LinkCard({ href, icon, label, sub }) {
  const { theme } = useTheme();
  const t = getT(theme);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderRadius: 6,
      border: `1px solid ${t.panelBorder}`,
      backgroundColor: t.cardBg || t.panel,
      textDecoration: 'none',
      transition: 'border-color 0.15s',
      flex: 1, minWidth: 180,
    }}
      onMouseOver={e => e.currentTarget.style.borderColor = 'rgba(74,143,204,0.45)'}
      onMouseOut={e => e.currentTarget.style.borderColor = t.panelBorder}
    >
      <div style={{ color: 'rgba(74,143,204,0.7)', flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: '0.68rem', fontWeight: 600, color: t.lbl }}>{label}</div>
        {sub && <div style={{ fontSize: '0.55rem', color: t.lblMuted, marginTop: 1 }}>{sub}</div>}
      </div>
    </a>
  );
}

export default function ContactPage() {
  const { theme } = useTheme();
  const t = getT(theme);
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('idle');

  const divider = { borderColor: t.panelBorder, margin: '28px 0' };

  async function handleSubmit(e) {
    e.preventDefault();
    if (!msg.trim()) return;
    setStatus('sending');
    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      setStatus(res.ok ? 'sent' : 'error');
      if (res.ok) setMsg('');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', backgroundColor: t.bg, color: t.text }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 32px 80px' }}>

        {/* Back */}
        <div style={{ marginBottom: 28 }}>
          <Link to="/" style={{ fontSize: '0.65rem', color: t.muted, letterSpacing: '1px' }}>
            ← Back to map
          </Link>
        </div>

        {/* Header */}
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: t.text, marginBottom: 6 }}>
          About
        </h1>
        <p style={{ fontSize: '0.75rem', color: t.muted, lineHeight: 1.65, marginBottom: 24 }}>
          An open tool for exploring power-sector data across regions — generation mix, installed
          capacity, power plants, grid infrastructure, renewable energy resources, and country profiles.
          Developed with the support of{' '}
          <ExternalLink href="https://www.esmap.org">ESMAP</ExternalLink>
          {' '}/ World Bank.
        </p>

        {/* Data note → Limitations */}
        <div style={{
          marginBottom: 24, padding: '12px 14px', borderRadius: 8,
          border: `1px solid ${t.panelBorder}`,
          borderLeft: '3px solid rgba(252,196,25,0.8)',
          background: t.isDark ? 'rgba(252,196,25,0.045)' : 'rgba(252,196,25,0.05)',
          fontSize: '0.68rem', color: t.muted, lineHeight: 1.6,
        }}>
          <span aria-hidden="true" style={{ marginRight: 6 }}>⚠</span>
          Data figures are aggregated and derived from open and public sources, which may not
          always be up to date.{' '}
          <Link to="/about#limitations" style={{ color: 'rgba(74,143,204,0.88)', textDecoration: 'none', fontWeight: 600 }}>
            See Limitations &amp; Disclaimer
          </Link>{' '}on the Data Sources page.
        </div>

        <div style={{ marginBottom: 32 }}>
          <a href="https://github.com/ESMAP-World-Bank-Group/regional-power-explorer/issues"
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '0.65rem', color: 'rgba(74,143,204,0.7)', textDecoration: 'none' }}
            onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'}
            onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}
          >
            Report an issue or suggest a feature ↗
          </a>
        </div>

        <hr style={divider} />

        {/* See also */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: '0.48rem', letterSpacing: '2px', fontWeight: 700, color: t.lblMuted, textTransform: 'uppercase', marginBottom: 14 }}>
            See also
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <LinkCard
              href="https://github.com/ESMAP-World-Bank-Group/EPM"
              label="EPM"
              sub="Electricity Planning Model"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                </svg>
              }
            />
            <LinkCard
              href="https://github.com/ESMAP-World-Bank-Group/epm-data-explorer"
              label="EPM Data Explorer"
              sub="EPM Data Explorer"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                </svg>
              }
            />
          </div>
        </div>

        {/* Feedback form */}
        <div>
          <div style={{ fontSize: '0.44rem', letterSpacing: '2px', fontWeight: 700, color: t.lblMuted, textTransform: 'uppercase', marginBottom: 14 }}>
            Questions or feedback
          </div>
          {status === 'sent' ? (
            <div style={{
              padding: '14px 16px', borderRadius: 6,
              backgroundColor: 'rgba(64,192,87,0.08)',
              border: '1px solid rgba(64,192,87,0.25)',
              fontSize: '0.7rem', color: t.muted,
            }}>
              Message sent — thanks!
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <textarea
                value={msg}
                onChange={e => { setMsg(e.target.value); if (status === 'error') setStatus('idle'); }}
                placeholder="Your message…"
                rows={4}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px', borderRadius: 6,
                  border: `1px solid ${status === 'error' ? 'rgba(250,82,82,0.5)' : t.panelBorder}`,
                  backgroundColor: t.panel, color: t.text,
                  fontSize: '0.72rem', lineHeight: 1.6,
                  resize: 'vertical', outline: 'none',
                  fontFamily: 'inherit',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(74,143,204,0.5)'}
                onBlur={e => e.target.style.borderColor = status === 'error' ? 'rgba(250,82,82,0.5)' : t.panelBorder}
              />
              <div style={{ fontSize: '0.58rem', color: t.lblMuted, marginTop: 6 }}>
                {status === 'error'
                  ? <span style={{ color: 'rgba(250,82,82,0.8)' }}>Something went wrong — try again or </span>
                  : 'Or '}
                Maelle Baronnet ·{' '}
                <a href="mailto:mbaronnet@worldbank.org"
                  style={{ color: 'rgba(74,143,204,0.7)', textDecoration: 'none' }}
                  onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}
                >
                  mbaronnet@worldbank.org
                </a>
              </div>
              <button
                type="submit"
                disabled={status === 'sending' || !msg.trim()}
                style={{
                  marginTop: 10, padding: '7px 18px', borderRadius: 5,
                  border: '1px solid rgba(74,143,204,0.35)',
                  backgroundColor: 'rgba(74,143,204,0.12)',
                  color: status === 'sending' || !msg.trim() ? t.muted : 'rgba(74,143,204,0.9)',
                  fontSize: '0.65rem', fontWeight: 600, cursor: status === 'sending' || !msg.trim() ? 'default' : 'pointer',
                  transition: 'opacity 0.15s',
                }}
              >
                {status === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}
