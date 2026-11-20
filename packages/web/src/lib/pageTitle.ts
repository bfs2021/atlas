import type { RouteLocationNormalized } from 'vue-router';
import { cityLabel, parseCompareCitiesParam, slugToDisplay } from './compare';

export const SITE_NAME = 'Atlas';

const SECTION_LABELS: Record<string, string> = {
  'city-income': 'Income',
  'city-housing': 'Housing',
  'city-details': 'City Details',
  'city-affordability': 'Affordability',
  'city-climate': 'Climate',
  'city-lifestyle': 'Lifestyle & Connectivity',
};

const STATIC_TITLES: Record<string, string> = {
  search: 'Search Cities',
  'compare-empty': 'Compare Cities',
  about: 'About',
  'data-sources': 'Data Sources',
  'how-scoring-works': 'How Scoring Works',
  contact: 'Contact',
  favorites: 'Favorites',
  'saved-comparisons': 'Saved Comparisons',
  profile: 'Profile',
  friends: 'Friends',
  'not-found': 'Page Not Found',
};

function param(route: RouteLocationNormalized, key: string): string {
  const v = route.params[key];
  return typeof v === 'string' ? v : '';
}

// Builds the page-specific part of the title from the route alone (URL slugs), so it's set
// synchronously on every navigation. Views that load nicer names (e.g. a full state name)
// can refine it afterwards with setPageTitle().
export function titleForRoute(route: RouteLocationNormalized): string | null {
  const name = typeof route.name === 'string' ? route.name : '';
  const state = param(route, 'state');
  const city = param(route, 'city');

  if (name === 'city' && city && state) return cityLabel(city, state);
  if (SECTION_LABELS[name] && city && state) return `${SECTION_LABELS[name]} · ${cityLabel(city, state)}`;
  if (name === 'housing' && city && state) return `Housing · ${cityLabel(city, state)}`;
  if (name === 'state-browse') return param(route, 'code').toUpperCase() || null;
  if (name === 'compare') {
    const cities = parseCompareCitiesParam(param(route, 'cities'));
    if (!cities.length) return 'Compare Cities';
    return `Compare ${cities.map((c) => slugToDisplay(c.city)).join(' vs ')}`;
  }
  if (name === 'user-profile') return `@${param(route, 'username')}`;
  if (name === 'user-favorites') return `@${param(route, 'username')}'s Favorites`;
  if (name === 'user-comparisons') return `@${param(route, 'username')}'s Comparisons`;
  return STATIC_TITLES[name] ?? null;
}

export function setPageTitle(pageTitle: string | null | undefined) {
  document.title = pageTitle ? `${pageTitle} | ${SITE_NAME}` : SITE_NAME;
}
