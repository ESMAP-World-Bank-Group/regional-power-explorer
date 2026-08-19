import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../App';
import { getT } from '../constants';

const FORMSPREE_ID = 'mlgkpwav';

// Google Apps Script web-app URL (deploy → "Anyone" access). Paste it here once
// the script is deployed; until then the request form shows a short notice.
const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxKtNsfk0dX5SET9ajr4jZ0YK058f94jyjzTpiUFQZZkp9jTh6p_TtPiI6Gv6UeLhTx/exec';

export default function ContactPage() {
  const { theme } = useTheme();
  const t = getT(theme);
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('idle');

  // Feature / data request form
  const [req, setReq] = useState({ firstName: '', lastName: '', email: '', request: '' });
  const [reqStatus, setReqStatus] = useState('idle');

  const divider = { borderColor: t.panelBorder, margin: '28px 0' };

  async function handleRequestSubmit(e) {
    e.preventDefault();
    if (!req.request.trim() || !req.email.trim()) return;
    if (!GOOGLE_APPS_SCRIPT_URL) { setReqStatus('unconfigured'); return; }
    setReqStatus('sending');
    try {
      // x-www-form-urlencoded avoids a CORS preflight; no-cors → opaque response,
      // so we treat a resolved fetch as success (the Apps Script still runs).
      await fetch(GOOGLE_APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: new URLSearchParams({
          name: `${req.firstName} ${req.lastName}`.trim(),
          firstName: req.firstName,
          lastName: req.lastName,
          email: req.email,
          request: req.request,
          source: 'Regional Power Explorer',
        }),
      });
      setReqStatus('sent');
      setReq({ firstName: '', lastName: '', email: '', request: '' });
    } catch {
      setReqStatus('error');
    }
  }

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
          It is a pilot, is not an official product of any institution, and carries no institutional
          endorsement. Figures are indicative and parts of the content were drafted with AI assistance.
        </p>

        {/* GitHub repository — prominent */}
        <a
          href="https://github.com/ESMAP-World-Bank-Group/regional-power-explorer"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
            padding: '14px 16px', borderRadius: 8, textDecoration: 'none',
            border: '1px solid rgba(74,143,204,0.35)',
            borderLeft: '3px solid rgba(74,143,204,0.85)',
            background: t.isDark ? 'rgba(74,143,204,0.07)' : 'rgba(74,143,204,0.06)',
          }}
        >
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: t.text }}>
              Source code on GitHub
            </span>
            <span style={{ display: 'block', fontSize: '0.65rem', color: t.muted, marginTop: 3, lineHeight: 1.5 }}>
              regional-power-explorer
            </span>
          </span>
          <span aria-hidden="true" style={{ fontSize: '0.85rem', color: 'rgba(74,143,204,0.9)', fontWeight: 700 }}>↗</span>
        </a>

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

        {/* ── Request a feature or dataset ────────────────────────── */}
        <div style={{
          marginBottom: 28, padding: '16px 18px', borderRadius: 8,
          border: '1px solid rgba(74,143,204,0.35)',
          borderLeft: '3px solid rgba(74,143,204,0.85)',
          background: t.isDark ? 'rgba(74,143,204,0.06)' : 'rgba(74,143,204,0.05)',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: t.text, marginBottom: 3 }}>
            Want something added?
          </div>
          <p style={{ fontSize: '0.66rem', color: t.muted, lineHeight: 1.6, marginBottom: 12 }}>
            Missing a country, dataset, or feature? Send a request — it goes straight to our tracker.
          </p>

          {reqStatus === 'sent' ? (
            <div style={{
              padding: '12px 14px', borderRadius: 6,
              backgroundColor: 'rgba(64,192,87,0.08)', border: '1px solid rgba(64,192,87,0.25)',
              fontSize: '0.7rem', color: t.muted,
            }}>
              Request received — thanks! We'll follow up if needed.
            </div>
          ) : (
            <form onSubmit={handleRequestSubmit}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <input
                  type="text" value={req.firstName} required
                  onChange={e => { setReq({ ...req, firstName: e.target.value }); if (reqStatus !== 'idle') setReqStatus('idle'); }}
                  placeholder="First name"
                  style={{
                    flex: '1 1 120px', minWidth: 0, boxSizing: 'border-box', padding: '8px 10px',
                    borderRadius: 6, border: `1px solid ${t.panelBorder}`, backgroundColor: t.panel,
                    color: t.text, fontSize: '0.7rem', outline: 'none', fontFamily: 'inherit',
                  }}
                />
                <input
                  type="text" value={req.lastName} required
                  onChange={e => { setReq({ ...req, lastName: e.target.value }); if (reqStatus !== 'idle') setReqStatus('idle'); }}
                  placeholder="Last name"
                  style={{
                    flex: '1 1 120px', minWidth: 0, boxSizing: 'border-box', padding: '8px 10px',
                    borderRadius: 6, border: `1px solid ${t.panelBorder}`, backgroundColor: t.panel,
                    color: t.text, fontSize: '0.7rem', outline: 'none', fontFamily: 'inherit',
                  }}
                />
                <input
                  type="email" value={req.email} required
                  onChange={e => { setReq({ ...req, email: e.target.value }); if (reqStatus !== 'idle') setReqStatus('idle'); }}
                  placeholder="Your email"
                  style={{
                    flex: '1 1 100%', minWidth: 0, boxSizing: 'border-box', padding: '8px 10px',
                    borderRadius: 6, border: `1px solid ${t.panelBorder}`, backgroundColor: t.panel,
                    color: t.text, fontSize: '0.7rem', outline: 'none', fontFamily: 'inherit',
                  }}
                />
              </div>
              <textarea
                value={req.request} required rows={3}
                onChange={e => { setReq({ ...req, request: e.target.value }); if (reqStatus !== 'idle') setReqStatus('idle'); }}
                placeholder="What would you like added or changed? (country, dataset, feature…)"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 6,
                  border: `1px solid ${t.panelBorder}`, backgroundColor: t.panel, color: t.text,
                  fontSize: '0.72rem', lineHeight: 1.6, resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <button
                  type="submit"
                  disabled={reqStatus === 'sending' || !req.request.trim() || !req.email.trim()}
                  style={{
                    padding: '7px 18px', borderRadius: 5, border: '1px solid rgba(74,143,204,0.4)',
                    backgroundColor: 'rgba(74,143,204,0.14)',
                    color: reqStatus === 'sending' || !req.request.trim() || !req.email.trim() ? t.muted : 'rgba(74,143,204,0.95)',
                    fontSize: '0.65rem', fontWeight: 700,
                    cursor: reqStatus === 'sending' || !req.request.trim() || !req.email.trim() ? 'default' : 'pointer',
                  }}
                >
                  {reqStatus === 'sending' ? 'Sending…' : 'Send request'}
                </button>
                {reqStatus === 'error' && (
                  <span style={{ fontSize: '0.6rem', color: 'rgba(250,82,82,0.85)' }}>Something went wrong — try again.</span>
                )}
                {reqStatus === 'unconfigured' && (
                  <span style={{ fontSize: '0.6rem', color: 'rgba(252,196,25,0.9)' }}>Request form not yet connected.</span>
                )}
              </div>
              <p style={{ fontSize: '0.55rem', color: t.lblMuted, marginTop: 8, lineHeight: 1.5 }}>
                Your email is used only to follow up on this request.
              </p>
            </form>
          )}
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

        {/* The development status & coverage roadmap used to be linked here. It is an
            internal working document: it carries institutional branding, names sources
            that are not cleared for publication, and records open questions rather than
            settled positions. It now lives in data-source/, outside public/, so the build
            cannot copy it into dist/ and it is not reachable by direct URL. */}

      </div>
    </div>
  );
}
