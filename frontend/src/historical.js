/**
 * Historical Noma case counts from the published literature.
 *
 * These are aggregate totals for a site over a study period — not individual
 * patient locations. Earlier versions scattered one random dot per case around
 * each city, which drew ~4,900 markers (slow) and, worse, rendered invented
 * coordinates as if each were an observed case. Each site is now a single
 * circle sized by its total, which is what the source data actually supports.
 */

export const HISTORICAL_SITES = [
  { lat: 11.85, lng: 13.16, label: 'Maiduguri, Nigeria', period: '2011–2020', cases: 1240, region: 'Borno State' },
  { lat: 12.0, lng: 8.52, label: 'Kano, Nigeria', period: '2011–2020', cases: 980, region: 'Kano State' },
  { lat: 10.52, lng: 7.44, label: 'Kaduna, Nigeria', period: '2011–2020', cases: 870, region: 'Kaduna State' },
  { lat: 13.06, lng: 5.24, label: 'Sokoto, Nigeria', period: '2011–2020', cases: 760, region: 'Sokoto State' },
  { lat: 9.07, lng: 7.4, label: 'Abuja, Nigeria', period: '2011–2020', cases: 420, region: 'FCT' },
  { lat: 7.38, lng: 3.9, label: 'Ibadan, Nigeria', period: '1982–1996', cases: 133, region: 'Oyo State' },
  { lat: 12.6, lng: 37.47, label: 'Gondar, Ethiopia', period: '2004–2023', cases: 94, region: 'Amhara Region' },
  { lat: 11.59, lng: 37.39, label: 'Bahir Dar, Ethiopia', period: '2004–2023', cases: 88, region: 'Amhara Region' },
  { lat: 9.03, lng: 38.74, label: 'Addis Ababa, Ethiopia', period: '2015–2019', cases: 80, region: 'Addis Ababa' },
  { lat: 13.8, lng: 8.99, label: 'Zinder, Niger', period: '2001–2006', cases: 82, region: 'Zinder Region' },
  { lat: 14.69, lng: -17.44, label: 'Dakar, Senegal', period: '1981–1993', cases: 73, region: 'Dakar Region' },
  { lat: 16.02, lng: -16.49, label: 'Saint-Louis, Senegal', period: '2012–2014', cases: 31, region: 'Saint-Louis Region' },
  { lat: 14.49, lng: -4.2, label: 'Mopti, Mali', period: '2004–2009', cases: 68, region: 'Mopti Region' },
  { lat: 16.27, lng: -0.04, label: 'Gao, Mali', period: '2004–2009', cases: 52, region: 'Gao Region' },
  { lat: 16.77, lng: -3.0, label: 'Tombouctou, Mali', period: '2004–2009', cases: 43, region: 'Tombouctou Region' },
];

export const HISTORICAL_TOTAL = HISTORICAL_SITES.reduce((sum, s) => sum + s.cases, 0);

export const HISTORICAL_COLOR = '#a855f7';

/** Marker radius in pixels, scaled by case count on a square-root curve. */
export function historicalRadius(cases) {
  return Math.max(6, Math.min(26, Math.sqrt(cases) * 0.7));
}
