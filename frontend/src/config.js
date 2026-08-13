/**
 * Build-time configuration.
 *
 * Values come from Vite environment variables and are inlined at build time.
 * The pages previously hardcoded `http://localhost:3001`, so every deployed
 * build pointed at the developer's own machine and silently failed.
 */

/**
 * Base URL of the orchestrator API.
 *
 * Defaults to same-origin (''), which works when the API is proxied under
 * /api — that is what `vite dev` does and what a reverse proxy should do in
 * production. Set VITE_API_URL when the API lives on another host.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Firebase web config. Absent in local builds, which disables phone sign-in. */
export const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Whether phone sign-in can work in this build. */
export const FIREBASE_ENABLED = Boolean(
  FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.authDomain && FIREBASE_CONFIG.projectId,
);

/** localStorage key for the CHW bearer token. */
export const TOKEN_KEY = 'lumos_token';

/** localStorage key for the signed-in CHW's display name. */
export const NAME_KEY = 'lumos_name';

/** sessionStorage key handing a screening result to the 3D viewer page. */
export const RESULT_KEY = 'lumos_result';

/**
 * Triage colours.
 *
 * Null-prototype so a lookup with an unexpected key ("constructor",
 * "__proto__") yields undefined and falls through to the default, rather than
 * returning something off Object.prototype that then gets interpolated into
 * markup.
 */
export const TRIAGE_COLOR = Object.assign(Object.create(null), {
  urgent: '#e84040',
  refer: '#f59e0b',
  monitor: '#3b82f6',
  healthy: '#22c55e',
});

/** Look up a triage colour, falling back to the urgent colour. */
export function triageColor(triage) {
  return TRIAGE_COLOR[triage] ?? TRIAGE_COLOR.urgent;
}
