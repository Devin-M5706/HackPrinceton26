/**
 * Shared Leaflet case map, used by both the landing page and the full-screen
 * map page.
 *
 * Live points come from the de-identified /api/cases/map feed: coordinates are
 * rounded server-side to a ~1.1 km grid and carry no patient or reporter
 * identifiers. The popups reflect that — there is deliberately no age, no
 * reporting CHW and no clinical note.
 */

import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import { triageColor } from './config.js';
import { escapeHtml, formatDate, titleCase } from './dom.js';
import { getCaseMap } from './api.js';
import { HISTORICAL_COLOR, HISTORICAL_SITES, historicalRadius } from './historical.js';

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '© OpenStreetMap © CARTO';

const REFRESH_INTERVAL_MS = 60_000;

function pinIcon(color) {
  return L.divIcon({
    html:
      `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="24" viewBox="0 0 20 26">` +
      `<path d="M10 0C4.477 0 0 4.477 0 10c0 7 10 16 10 16S20 17 20 10C20 4.477 15.523 0 10 0z" fill="${color}" opacity=".9"/>` +
      `<circle cx="10" cy="10" r="4" fill="white" opacity=".9"/></svg>`,
    className: '',
    iconSize: [18, 24],
    iconAnchor: [9, 24],
    popupAnchor: [0, -24],
  });
}

function historicalPopup(site) {
  return `
    <div class="popup-stage" style="color:${HISTORICAL_COLOR}">${escapeHtml(site.label)}</div>
    <div class="popup-row">Region: <span>${escapeHtml(site.region)}</span></div>
    <div class="popup-row">Period: <span>${escapeHtml(site.period)}</span></div>
    <div class="popup-row">Reported cases: <span>${escapeHtml(site.cases.toLocaleString())}</span></div>
    <div class="popup-note">Aggregate total from published literature, not individual case locations.</div>
  `;
}

function casePopup(point) {
  const color = triageColor(point.triage);
  return `
    <div class="popup-stage" style="color:${color}">
      Stage ${escapeHtml(point.stage ?? '?')} — ${escapeHtml(titleCase(point.triage))}
    </div>
    <div class="popup-row">Region: <span>${escapeHtml(point.region || '—')}</span></div>
    <div class="popup-row">Reported: <span>${escapeHtml(formatDate(point.created_at))}</span></div>
    <div class="popup-note">Location approximate to ~1km. No identifying details are published.</div>
  `;
}

/**
 * Mount the map into a container element.
 *
 * @param {object} options
 * @param {string} options.containerId       element to render into
 * @param {boolean} [options.scrollWheelZoom] false for the embedded map, so
 *                                            page scrolling is not hijacked
 * @param {boolean} [options.fitBounds]       zoom to fit on first load
 * @param {(summary: object) => void} [options.onSummary] receives live counts
 * @returns {{ destroy: () => void }}
 */
export function createCaseMap({
  containerId,
  scrollWheelZoom = true,
  fitBounds = true,
  zoomControlPosition = 'bottomright',
  onSummary,
  onError,
}) {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`Map container #${containerId} not found`);

  const map = L.map(container, {
    center: [12, 5],
    zoom: 4,
    zoomControl: false,
    scrollWheelZoom,
  });

  L.control.zoom({ position: zoomControlPosition }).addTo(map);
  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  // Historical sites: one proportional circle each, added once.
  const historicalLayer = L.layerGroup().addTo(map);
  for (const site of HISTORICAL_SITES) {
    L.circleMarker([site.lat, site.lng], {
      radius: historicalRadius(site.cases),
      color: HISTORICAL_COLOR,
      weight: 1.5,
      fillColor: HISTORICAL_COLOR,
      fillOpacity: 0.25,
    })
      .bindPopup(historicalPopup(site), { maxWidth: 260 })
      .addTo(historicalLayer);
  }

  const liveLayer = L.markerClusterGroup({
    maxClusterRadius: 40,
    showCoverageOnHover: false,
    chunkedLoading: true,
  });
  map.addLayer(liveLayer);

  let firstLoad = true;
  let disposed = false;

  async function refresh() {
    try {
      const response = await getCaseMap();
      if (disposed) return;

      const points = response?.data ?? [];
      liveLayer.clearLayers();

      for (const point of points) {
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
        const color = triageColor(point.triage);
        liveLayer.addLayer(
          L.marker([point.lat, point.lng], { icon: pinIcon(color) }).bindPopup(
            casePopup(point),
            { maxWidth: 240 },
          ),
        );
      }

      onSummary?.(response?.summary ?? { total: points.length, urgent: 0, refer: 0 });

      if (firstLoad && fitBounds) {
        firstLoad = false;
        const bounds = L.featureGroup([historicalLayer, liveLayer]).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 7 });
      }
    } catch (error) {
      onError?.(error);
    }
  }

  void refresh();
  const timer = setInterval(refresh, REFRESH_INTERVAL_MS);

  return {
    refresh,
    destroy() {
      disposed = true;
      clearInterval(timer);
      map.remove();
    },
  };
}
