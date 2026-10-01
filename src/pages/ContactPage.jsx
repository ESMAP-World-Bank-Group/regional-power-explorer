import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../App';
import { getT } from '../constants';
import { CONTACT_EMAIL, openMail } from '../utils/mailto';

export default function ContactPage() {
  const { theme } = useTheme();
  const t = getT(theme);
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('idle');

  // Feature / data request form
  const [req, setReq] = useState('');
  const [reqStatus, setReqStatus] = useState('idle');

  const divider = { borderColor: t.panelBorder, margin: '28px 0' };

  function handleRequestSubmit(e) {
    e.preventDefault();
    if (!req.trim()) return;
    openMail('Regional Power Explorer: request', req);
    setReqStatus('sent');
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!msg.trim()) return;
    openMail('Regional Power Explorer: feedback', msg);
    setStatus('sent');
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
        <p style={{ fontSize: '0.75rem', color: t.muted, lineHeight: 1.65, marginBottom: 10 }}>
          An open tool for exploring power-sector data across regions — generation mix, installed
          capacity, power plants, grid infrastructure, renewable energy resources, and country profiles.
          It is a pilot, is not an official product of any institution, and carries no institutional
          endorsement. Figures are indicative and parts of the content were drafted with AI assistance.
        </p>
        {/* Support, not endorsement — kept deliberately quiet, and separate from the
            paragraph above so it cannot be read as walking back the disclaimer. */}
        <p style={{ fontSize: '0.65rem', color: t.muted, opacity: 0.75, lineHeight: 1.6, marginBottom: 24 }}>
          Developed with support from ESMAP and the World Bank.
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
            Missing a country, dataset, or feature? Write it here and send it from your email app.
          </p>

          {reqStatus === 'sent' ? (
            <div style={{
              padding: '12px 14px', borderRadius: 6,
              backgroundColor: 'rgba(64,192,87,0.08)', border: '1px solid rgba(64,192,87,0.25)',
              fontSize: '0.7rem', color: t.muted,
            }}>
              Your email app should now be open with the request ready to send. If it isn't,
              write to {CONTACT_EMAIL}.
            </div>
          ) : (
            <form onSubmit={handleRequestSubmit}>
              <textarea
                value={req} required rows={3}
                onChange={e => setReq(e.target.value)}
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
                  disabled={!req.trim()}
                  style={{
                    padding: '7px 18px', borderRadius: 5, border: '1px solid rgba(74,143,204,0.4)',
                    backgroundColor: 'rgba(74,143,204,0.14)',
                    color: !req.trim() ? t.muted : 'rgba(74,143,204,0.95)',
                    fontSize: '0.65rem', fontWeight: 700,
                    cursor: !req.trim() ? 'default' : 'pointer',
                  }}
                >
                  Send request
                </button>
              </div>
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
              Your email app should now be open with the message ready to send. If it isn't,
              write to {CONTACT_EMAIL}.
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <textarea
                value={msg}
                onChange={e => setMsg(e.target.value)}
                placeholder="Your message…"
                rows={4}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px', borderRadius: 6,
                  border: `1px solid ${t.panelBorder}`,
                  backgroundColor: t.panel, color: t.text,
                  fontSize: '0.72rem', lineHeight: 1.6,
                  resize: 'vertical', outline: 'none',
                  fontFamily: 'inherit',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(74,143,204,0.5)'}
                onBlur={e => e.target.style.borderColor = t.panelBorder}
              />
              <div style={{ fontSize: '0.58rem', color: t.lblMuted, marginTop: 6 }}>
                Or write directly: Maelle Baronnet ·{' '}
                <a href={`mailto:${CONTACT_EMAIL}`}
                  style={{ color: 'rgba(74,143,204,0.7)', textDecoration: 'none' }}
                  onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}
                >
                  {CONTACT_EMAIL}
                </a>
              </div>
              <button
                type="submit"
                disabled={!msg.trim()}
                style={{
                  marginTop: 10, padding: '7px 18px', borderRadius: 5,
                  border: '1px solid rgba(74,143,204,0.35)',
                  backgroundColor: 'rgba(74,143,204,0.12)',
                  color: !msg.trim() ? t.muted : 'rgba(74,143,204,0.9)',
                  fontSize: '0.65rem', fontWeight: 600, cursor: !msg.trim() ? 'default' : 'pointer',
                  transition: 'opacity 0.15s',
                }}
              >
                Send
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
