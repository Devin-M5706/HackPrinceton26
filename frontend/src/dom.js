/**
 * Small DOM helpers.
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for interpolation into an HTML string.
 *
 * Map popups are built as HTML strings and fed to Leaflet's `bindPopup`, which
 * parses them. Region names and clinic names come from the database, so
 * inserting them raw made stored text an injection vector into every viewer's
 * page. Everything interpolated into markup goes through here.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** `document.getElementById`, throwing early if the element is missing. */
export function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element;
}

/** `document.getElementById` that tolerates absence. */
export function maybeId(id) {
  return document.getElementById(id);
}

/** Set text content on an element if it exists. */
export function setText(id, text) {
  const element = maybeId(id);
  if (element) element.textContent = String(text);
}

/** Format an ISO timestamp for display, tolerating bad input. */
export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Capitalise the first letter, for triage labels. */
export function titleCase(value) {
  const text = String(value ?? '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}
