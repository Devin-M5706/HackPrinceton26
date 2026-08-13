# Contributing

## Getting set up

Follow [Tutorial: run your first screening](tutorial-first-screening.md). It
gets both halves of the stack running in mock mode with no accounts to create.

## Before you open a pull request

Run what CI runs. From `backend/`:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

From `frontend/`:

```bash
npm run lint
npm run build
```

Details and troubleshooting: [How to run the tests](howto-run-tests.md).

## What CI enforces

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`.

| Job | Steps |
|---|---|
| Backend | `npm ci`, lint, typecheck, test, build, then boot `dist/index.js` and poll `/api/health` |
| Frontend | `npm ci`, lint, build |

Concurrency is set to `cancel-in-progress`, so pushing again supersedes the
in-flight run.

The boot check exists because `npm run build` succeeding is not the same as
`npm start` working. A module-format mismatch only shows up at runtime.

## Conventions

These are the rules the codebase is built on. Breaking one is usually a bug, not
a style disagreement.

**Never call `process.env` outside `config.ts`.** Values are parsed and
validated once at import time. A missing or malformed value fails at boot with a
readable message rather than surfacing as `undefined` deep inside a request.

**Wrap every async handler in `asyncHandler`.** Express 4 does not catch
rejected promises from async middleware. An unwrapped `await` that throws leaves
the request hanging until the client times out, and surfaces as an
`unhandledRejection` on the process.

**Treat model output as untrusted input.** Parse it with a Zod schema via
`parseModelJson`, which returns `null` instead of throwing. Every caller needs a
clinically safe fallback: a partially-parsed medical result is worse than none.

**Failure means "refer", not a plausible guess.** When a pipeline stage fails,
do not substitute canned findings. Return empty, flag `degraded`, and let the UI
say the assessment was incomplete. See
[why](explanation-safety-model.md).

**Never log patient data.** The logger redacts a known list of field names, but
the rule is not to pass images, tokens, phone numbers, coordinates or clinical
notes in the first place.

**Never put a secret in `frontend/.env`.** Every `VITE_*` value is inlined into
the bundle and is public.

**Register new frontend pages in `vite.config.js`.** A new HTML entry point
works in dev and is silently missing from `dist/` until it is added to
`build.rollupOptions.input`.

## Testing expectations

Add a test when you change access control, validation, or geo maths. Those three
have suites specifically because they are where a quiet mistake does damage:

- `tests/case-scope.test.ts` — who can read which cases
- `tests/validation.test.ts` — what the API accepts
- `tests/auth.test.ts` — token generation, hashing, comparison
- `tests/api.test.ts` — the routes end to end, including auth regressions

Route changes should be tested through the app with supertest, not by calling
the handler directly, so middleware and the error handler are exercised too.

Tests run in mock mode with no network. If your change needs different
environment variables, put it in its own file — the Vitest pool is `forks`
because config and the Supabase/inference clients are module-level singletons.

## Database changes

Migrations are numbered and live in `backend/supabase/migrations/`. Add a new
file rather than editing an existing one; migration 003 backfills existing rows
and is safe to re-run on a live database, and new migrations should hold that
property.

`seed.sql` is local development only.

## Cost note

The surveillance agent provisions a VM that bills by the hour. It only starts
when `ORCHESTRATOR_URL` is set. If a process is killed without a clean shutdown,
destroy anything orphaned:

```bash
cd backend
npm run cleanup:vms -- --yes
```

## Diagrams

Architecture diagrams live in [`diagrams/`](../diagrams/) as mermaid `.mmd`
sources alongside editable `.excalidraw` scenes and rendered `.svg`/`.png`. The
`.mmd` file is the source of truth. Edit it and re-render, or open the
`.excalidraw` at excalidraw.com.

## Related

- [Testing reference](reference-testing.md)
- [Frontend reference](reference-frontend.md)
- [Backend layout and conventions](../backend/README.md)
