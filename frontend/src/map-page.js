/**
 * Full-screen case map entry point.
 */

import './styles/theme.css';
import './styles/map-page.css';

import { maybeId, setText } from './dom.js';
import { createCaseMap } from './case-map.js';
import { HISTORICAL_TOTAL } from './historical.js';

setText('s-historical', HISTORICAL_TOTAL.toLocaleString());

function hideLoading() {
  const loading = maybeId('loading');
  if (loading) loading.style.display = 'none';
}

createCaseMap({
  containerId: 'map',
  scrollWheelZoom: true,
  fitBounds: true,
  onSummary(summary) {
    hideLoading();
    setText('s-total', summary.total ?? 0);
    setText('s-urgent', summary.urgent ?? 0);
    setText('s-refer', summary.refer ?? 0);
  },
  onError() {
    const loading = maybeId('loading');
    if (loading) {
      loading.textContent = 'Could not load live cases. Historical data is shown.';
    }
  },
});
