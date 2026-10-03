import { lazy } from 'react';

// Every page but the world map loads in its own chunk, so a first visit only
// downloads what the world map needs. prefetchPages() fetches the region and
// country pages once the world map has drawn, so a click on a region does not
// wait for its code.
const loadRegion  = () => import('./RegionPage');
const loadCountry = () => import('./CountryPage');

export const RegionPage  = lazy(loadRegion);
export const CountryPage = lazy(loadCountry);
export const AboutPage   = lazy(() => import('./AboutPage'));
export const ContactPage = lazy(() => import('./ContactPage'));

export function prefetchPages() {
  loadRegion().catch(() => {});
  loadCountry().catch(() => {});
}
