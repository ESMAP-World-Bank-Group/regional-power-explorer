// Whether this browser has dismissed the welcome panel (components/WelcomePanel).
// Remembered per browser, so the panel greets a first visit and then stays out
// of the way; "About this map" brings it back.
const SEEN_KEY = 'rpe-welcome-seen';

export function welcomeSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export function rememberWelcomeSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: show again next time */ }
}
