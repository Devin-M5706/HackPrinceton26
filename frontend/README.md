# lumos.health — web app

Vite multi-page app in plain JavaScript: the landing page and screening panel,
the case map, and the 3D result viewer. See the
[repository README](../README.md) for the full setup, and the
[frontend reference](../docs/reference-frontend.md) for the module-by-module
surface.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: all values have working defaults
npm run dev                  # http://localhost:5173
```

`npm run dev` proxies `/api` to `http://localhost:3001`, so a local backend
needs no CORS configuration and `VITE_API_URL` can stay blank.

```bash
npm run build     # → dist/
npm run preview   # serve the built output
npm run lint      # eslint
```

## Layout

```
index.html           Landing page: hero, case map, sign-in, screening panel
map.html             Full-screen case map
viewer.html          3D result viewer
vite.config.js       Multi-page build + /api dev proxy
src/
  config.js          Build-time config from VITE_* vars, storage keys, triage colours
  api.js             Orchestrator client (30s timeout, 120s for screening)
  auth.js            Firebase phone sign-in, lazily imported
  login-modal.js     Sign-in modal: role → phone → OTP
  screening.js       Screening form, client-side limits, hands off to the viewer
  case-map.js        Shared Leaflet map, de-identified live feed
  historical.js      Published aggregate case counts per site
  viewer.js          Three.js result viewer
  dom.js             Escaping and small DOM helpers
  main.js            Landing page entry
  map-page.js        Map page entry
  styles/            theme.css + one stylesheet per page
```

## Conventions

**Every `VITE_*` value is public.** Vite inlines them into the bundle at build
time. Never put a service-role key or an API secret in `.env.local`.

**Register new pages in `vite.config.js`.** A new HTML entry point works under
`npm run dev` and is silently missing from `dist/` until it is added to
`build.rollupOptions.input`.

**Use `maybeId` for elements that only exist on some pages.** `byId` throws when
the element is missing, which is what you want for a required node and not what
you want for shared code running on three different pages.

**Escape anything interpolated into markup.** `escapeHtml` in `dom.js`. The
triage colour lookup is a null-prototype object for the same reason: a lookup
with an unexpected key yields `undefined` rather than something off
`Object.prototype`.

**Dependencies are bundled, not fetched from a CDN.** Leaflet, Three.js and
Firebase used to be `<script>` tags pointing at unpkg, gstatic and esm.sh, which
meant three third-party CDNs could each break or alter the app at runtime with
no subresource integrity to detect it.

**The map shows de-identified data.** Live points come from `/api/cases/map`,
where coordinates are rounded server-side to a ~1.1 km grid. Popups deliberately
carry no age, reporting worker, or clinical note. Do not add them.

## Testing

There are no frontend unit tests. CI runs ESLint and a production build. Changes
to the screening form, the map popups, or the viewer's disclaimers should be
checked by hand against
[the tutorial](../docs/tutorial-first-screening.md).
