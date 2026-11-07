import { track as vercelTrack } from '@vercel/analytics';
import './posthog';

export function track(event, props) {
  vercelTrack(event, props);
  window.posthog?.capture(event, props);
}
