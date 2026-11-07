// PostHog product analytics: pageviews, clicks, session replay, heatmaps,
// web vitals, errors and visitor location (city and country from the IP).
//
// Loaded on the Vercel build only (regional-power-explorer.vercel.app), behind
// the same gate as Vercel Analytics in App.jsx. The Design Studio build sends
// no visitor data to third parties: the whole block below, loader and key
// included, is dropped from its bundle at build time.
//
// The SDK comes from PostHog's CDN at run time, with no npm dependency. The one
// long line is PostHog's official loader snippet, verbatim: it creates the
// window.posthog stub, queues any call made before the SDK has arrived and
// replays it once loaded. Leave it as it is.

const KEY = 'phc_yzVnQUAKHTHfcx3hPANVVyWP97QHuUbvFr3Fm6n4weKL';
const HOST = 'https://us.i.posthog.com';

if (import.meta.env.BASE_URL === '/') {
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+" (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId setPersonPropertiesForFlags".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  // Routes live in the URL hash (HashRouter in App.jsx), so the browser path
  // is "/" on every page. Give each event the route instead ("/region/EAPP"),
  // so PostHog's web analytics, paths and funnels tell the pages apart.
  const routePath = () => window.location.hash.replace(/^#/, '').split('?')[0] || '/';
  let lastRoute = routePath();
  const withRoute = event => {
    const props = event?.properties;
    if (!props || !('$pathname' in props)) return event;
    props.$pathname = routePath();
    if (event.event === '$pageview') {
      if ('$prev_pageview_pathname' in props) props.$prev_pageview_pathname = lastRoute;
      lastRoute = props.$pathname;
    }
    return event;
  };

  window.posthog.init(KEY, {
    api_host: HOST,
    before_send: withRoute,
    // A page change is a hash change. Without this the SDK only sees the
    // first page load.
    capture_pageview: { path: true, search: true, hash: true },
    capture_pageleave: true,
    // A person profile for every visitor, not only identified ones: location,
    // first and last seen, and the full journey under People.
    person_profiles: 'always',
    autocapture: { capture_copied_text: true },
    capture_dead_clicks: true,
    capture_heatmaps: true,
    capture_exceptions: true,
    capture_performance: { web_vitals: true, network_timing: true },
    // Replay shows what people type in the search and filter boxes, but never
    // the free-text forms (contact, suggest an edit) or anything sensitive.
    session_recording: {
      maskAllInputs: false,
      maskInputOptions: { password: true, email: true, textarea: true },
    },
  });

  // EPM View (epm-data-explorer.com) reports to the same PostHog project. This
  // super property goes out with every event so the two apps can be told apart
  // with one filter instead of the host name.
  window.posthog.register({ app: 'regional-power-explorer' });
}
