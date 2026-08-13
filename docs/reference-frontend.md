# Frontend reference

The web app is a Vite multi-page build in plain JavaScript. There is no
framework and no client-side router: each page is a real HTML entry point, so
the landing page loads without booting a router and the map never downloads the
3D viewer's Three.js bundle.

Source lives in `frontend/src/`. For setup and run commands see
[`frontend/README.md`](../frontend/README.md).

## Pages

| Entry HTML | Entry module | What it is |
|---|---|---|
| `index.html` | `src/main.js` | Landing page: hero, live case map, sign-in, screening panel |
| `map.html` | `src/map-page.js` | Full-screen case map with historical overlay |
| `viewer.html` | `src/viewer.js` | 3D result viewer, shaded by WHO stage |

Entry points are declared in `vite.config.js` under `build.rollupOptions.input`.
Adding a page means adding an HTML file **and** registering it there, otherwise
it is served in dev but silently missing from `dist/`.

## Environment variables

Copy `frontend/.env.example` to `frontend/.env.local`. Vite inlines every
`VITE_*` value into the bundle at build time, so all of them are **public**.
Never put a service-role key or an API secret here.

| Variable | Default | Effect |
|---|---|---|
| `VITE_API_URL` | `''` (same-origin) | Base URL of the orchestrator. Leave blank when a proxy serves `/api`. |
| `VITE_FIREBASE_API_KEY` | none | Firebase web API key. |
| `VITE_FIREBASE_AUTH_DOMAIN` | none | Firebase auth domain. |
| `VITE_FIREBASE_PROJECT_ID` | none | Firebase project ID. |
| `VITE_FIREBASE_APP_ID` | none | Firebase web app ID. |

If any of the first three Firebase values is missing, `FIREBASE_ENABLED` is
`false` and the UI reports phone sign-in as unavailable rather than initialising
with placeholder credentials and failing with an opaque error at the last step.

`npm run dev` proxies `/api` to `http://localhost:3001`, so local development
needs no CORS configuration and no `VITE_API_URL`.

## Modules

### `config.js` — build-time configuration

| Export | Type | Notes |
|---|---|---|
| `API_BASE` | `string` | `VITE_API_URL` with any trailing slash stripped. `''` means same-origin. |
| `FIREBASE_CONFIG` | `object` | The four `VITE_FIREBASE_*` values. |
| `FIREBASE_ENABLED` | `boolean` | True when apiKey, authDomain and projectId are all set. |
| `TOKEN_KEY` | `'lumos_token'` | localStorage key for the CHW bearer token. |
| `NAME_KEY` | `'lumos_name'` | localStorage key for the display name. |
| `RESULT_KEY` | `'lumos_result'` | sessionStorage key handing a result to the viewer. |
| `TRIAGE_COLOR` | `object` | Null-prototype map of triage level to hex colour. |
| `triageColor(triage)` | `string` | Colour lookup, falling back to the urgent colour. |

`TRIAGE_COLOR` has a null prototype on purpose. A lookup with an unexpected key
(`constructor`, `__proto__`) yields `undefined` and falls through to the default
instead of returning something off `Object.prototype` that then gets
interpolated into markup.

### `api.js` — orchestrator client

Requests time out at 30 s, except screening, which gets 120 s because it runs
three model calls.

| Export | Signature | Notes |
|---|---|---|
| `getToken()` | `() => string` | Bearer token from localStorage, `''` if absent. |
| `setToken(token)` | `(string) => void` | Persist the token. |
| `clearToken()` | `() => void` | Sign out. |
| `isSignedIn()` | `() => boolean` | Whether a token is stored. |
| `ApiError` | `class extends Error` | Carries the HTTP status and server error code. |
| `screen({ imageB64, childMeta, lat, lng })` | `=> Promise<TriagePacket>` | `POST /api/screen`. 120 s timeout. |
| `getCaseMap()` | `=> Promise<Point[]>` | `GET /api/cases/map`. De-identified, no auth. |
| `getAlertCount(days = 7)` | `=> Promise<{count}>` | `GET /api/alerts/count`. Badge only. |
| `signInWithFirebase(idToken)` | `=> Promise<{token}>` | Exchanges a Firebase ID token for a CHW token. |
| `getHealth()` | `=> Promise<Health>` | `GET /api/health`. Used to detect mock mode. |

### `auth.js` — Firebase phone sign-in

The browser runs the OTP flow against Firebase directly, then exchanges the
resulting ID token with the backend for a CHW bearer token. Firebase is imported
lazily, so a visitor who never signs in does not download the SDK.

| Export | Signature |
|---|---|
| `FIREBASE_ENABLED` | `boolean` (re-exported from `config.js`) |
| `requestOtp(phoneNumber, recaptchaContainerId)` | `=> Promise<void>` |
| `confirmOtp(code)` | `=> Promise<string>` (the CHW token) |
| `hasPendingConfirmation()` | `=> boolean` |
| `resetOtp()` | `=> void` |

### `case-map.js` — shared Leaflet map

`createCaseMap({ ... })` builds the map used by both the landing page and the
map page. Live points come from the de-identified `/api/cases/map` feed:
coordinates are rounded server-side to a ~1.1 km grid and carry no patient or
reporter identifiers. The popups reflect that — no age, no reporting CHW, no
clinical note.

### `screening.js` — screening panel

`initScreeningPanel()` wires the form on the landing page. Client-side limits
mirror the backend so a doomed upload is rejected before it is sent:

| Constant | Value |
|---|---|
| `MAX_IMAGE_BYTES` | 8 MB (matches the backend default) |
| `ACCEPTED_TYPES` | `image/jpeg`, `image/png`, `image/webp` |
| `GEOLOCATION_TIMEOUT_MS` | 5000 |
| `MAX_AGE_YEARS` | 18 |

On success the packet is written to `sessionStorage` under `RESULT_KEY` and the
browser navigates to `viewer.html`.

### `historical.js` — published case counts

| Export | Notes |
|---|---|
| `HISTORICAL_SITES` | Aggregate totals per site from published literature. |
| `HISTORICAL_TOTAL` | Sum of all site counts. |
| `HISTORICAL_COLOR` | `#a855f7`. |
| `historicalRadius(cases)` | Circle radius for a site total. |

These are aggregate totals for a site over a study period, not individual
patient locations. An earlier version scattered one random dot per case around
each city, which drew ~4,900 markers and, worse, rendered invented coordinates
as if each were an observed case. Each site is now one circle sized by its
total, which is what the source data actually supports.

### `viewer.js` — 3D result viewer

Renders a generic anatomical model shaded by WHO stage. It is a schematic
illustration of severity, not the patient's own anatomy and not a rendering of
their photograph. The page says so, because a realistic-looking 3D lesion reads
as imaging to anyone who is not told otherwise.

### `dom.js` — DOM helpers

`escapeHtml`, `byId`, `maybeId`, `setText`, `formatDate`, `titleCase`.
`byId` throws when the element is missing; `maybeId` returns `null`. Use
`maybeId` for elements that only exist on some pages.

## Build

```bash
npm run build      # → frontend/dist
npm run preview    # serve the built output
npm run lint       # eslint
```

`build.target` is `es2020` with sourcemaps on. The viewer chunk is large because
of Three.js, so `chunkSizeWarningLimit` is raised to 700 kB — only `viewer.html`
pays that cost.

Leaflet, Three.js and Firebase are npm dependencies bundled into the output.
They used to be `<script>` tags pointing at unpkg, gstatic and esm.sh, which
meant three third-party CDNs could each break or alter the app at runtime with
no subresource integrity to detect it.

## Related

- [Testing reference](reference-testing.md)
- [Why the app fails towards "refer"](explanation-safety-model.md)
- [Tutorial: your first screening](tutorial-first-screening.md)
