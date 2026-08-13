/**
 * Orchestrator API client.
 */

import { API_BASE, TOKEN_KEY } from './config.js';

const DEFAULT_TIMEOUT_MS = 30_000;
/** Screening runs three model calls, so it needs a much longer budget. */
const SCREEN_TIMEOUT_MS = 120_000;

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isSignedIn() {
  return getToken().length > 0;
}

/** Error carrying the HTTP status, so callers can special-case 401. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, auth = true, timeoutMs } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = getToken();
    if (!token) throw new ApiError('You need to sign in first.', 401);
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout or a dead backend should read as a connection problem, not as
    // an opaque "Failed to fetch".
    if (error?.name === 'TimeoutError') {
      throw new ApiError('The server took too long to respond.', 0);
    }
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, response.status);
  }

  return payload;
}

/** Run the triage pipeline on one photograph. */
export function screen({ imageB64, childMeta, lat, lng }) {
  return request('/api/screen', {
    method: 'POST',
    timeoutMs: SCREEN_TIMEOUT_MS,
    body: {
      image_b64: imageB64,
      child_meta: childMeta,
      ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
    },
  });
}

/** De-identified case points for the public map. No auth. */
export function getCaseMap() {
  return request('/api/cases/map', { auth: false });
}

/** Count of recent outbreak alerts, for the nav badge. No auth. */
export function getAlertCount(days = 7) {
  return request(`/api/alerts/count?days=${days}`, { auth: false });
}

/** Exchange a Firebase ID token for a CHW bearer token. */
export function signInWithFirebase(idToken) {
  return request('/api/auth/firebase', {
    method: 'POST',
    auth: false,
    body: { idToken },
  });
}

/** Server status, including whether it is running in mock mode. */
export function getHealth() {
  return request('/api/health', { auth: false, timeoutMs: 5000 });
}
