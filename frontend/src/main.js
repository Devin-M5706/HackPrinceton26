/**
 * Landing page entry point.
 */

import './styles/theme.css';
import './styles/landing.css';

import { maybeId, setText } from './dom.js';
import { clearToken, getAlertCount, isSignedIn } from './api.js';
import { NAME_KEY } from './config.js';
import { createCaseMap } from './case-map.js';
import { initLoginModal } from './login-modal.js';
import { initScreeningPanel } from './screening.js';
import { HISTORICAL_TOTAL } from './historical.js';

async function loadAlertBadge() {
  try {
    const { count } = await getAlertCount(7);
    setText('alert-count', count);
  } catch {
    // The badge is decorative; a backend that is down should not shout here.
    setText('alert-count', '—');
  }
}

function initMap() {
  createCaseMap({
    containerId: 'inline-map',
    scrollWheelZoom: false,
    fitBounds: false,
    onSummary(summary) {
      setText('ms-urgent', summary.urgent ?? 0);
      setText('ms-refer', summary.refer ?? 0);
      setText('ms-historical', HISTORICAL_TOTAL.toLocaleString());
    },
    onError() {
      setText('ms-urgent', '—');
      setText('ms-refer', '—');
      setText('ms-historical', HISTORICAL_TOTAL.toLocaleString());
    },
  });
}

/**
 * Reflect session state in the nav.
 *
 * Without this the button read "Sign in" even when signed in, giving no way to
 * tell whose session was active or to end it on a shared handset.
 */
function renderSessionState() {
  const loginButton = maybeId('nav-login-btn');
  const signOutButton = maybeId('nav-signout-btn');
  if (!loginButton || !signOutButton) return;

  if (isSignedIn()) {
    const name = localStorage.getItem(NAME_KEY) ?? 'CHW';
    loginButton.textContent = name;
    loginButton.disabled = true;
    signOutButton.hidden = false;
  } else {
    loginButton.textContent = 'Sign in';
    loginButton.disabled = false;
    signOutButton.hidden = true;
  }
}

initLoginModal(renderSessionState);
initScreeningPanel();
initMap();
renderSessionState();
void loadAlertBadge();

maybeId('nav-signout-btn')?.addEventListener('click', () => {
  clearToken();
  localStorage.removeItem(NAME_KEY);
  renderSessionState();
});
