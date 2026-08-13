# Testing reference

The backend has 58 tests across 5 suites, run with
[Vitest](https://vitest.dev). Everything runs offline: no database, no model
provider, no VMs, no network.

For the commands, see [How to run the tests](howto-run-tests.md).

## Configuration

`backend/vitest.config.ts`:

| Option | Value | Why |
|---|---|---|
| `environment` | `node` | No DOM needed. |
| `include` | `src/**/*.test.ts`, `tests/**/*.test.ts` | Co-located and standalone tests both run. |
| `setupFiles` | `tests/setup.ts` | Sets env before any module reads it. |
| `pool` | `forks` | Config and the Supabase/inference clients are module-level singletons, so suites that set different env must not share a worker. |
| `restoreMocks` | `true` | Mocks do not leak between tests. |

`tests/setup.ts` sets the environment before anything imports `src/config`,
which reads `process.env` once at import time:

```
NODE_ENV=test
MOCK_MODE=true
LOG_LEVEL=error
CORS_ORIGINS=http://localhost:5173
ORCHESTRATOR_INTERNAL_SECRET=test-secret-that-is-long-enough-to-pass-validation
```

No port is bound. `supertest` drives the Express app object directly.

## Suites

### `tests/api.test.ts` — 16 tests

Drives the real Express app end to end. This is where the access-control
regressions live.

| Group | Covers |
|---|---|
| `GET /api/health` | Public, reports status, does not leak configuration values |
| `authentication` | Rejects missing token, malformed `Authorization` header, and an arbitrary token even in mock mode; accepts the `demo` token only in mock mode |
| `internal endpoints` | VM provisioning and alert dispatch both refuse a missing or incorrect shared secret; the alert payload is validated after authentication |
| `POST /api/screen` | Rejects a body with no image and bytes that are not a supported image; labels mock results so they cannot be mistaken for a diagnosis; reports whether the case was persisted |
| `error handling` | 404 with a code for unknown routes; 400 for malformed JSON rather than hanging |

Three of these are regressions for real bugs: unauthenticated VM provisioning,
arbitrary tokens accepted in mock mode, and unvalidated alert payloads.

### `tests/auth.test.ts` — 10 tests

| Group | Covers |
|---|---|
| `generateToken` | URL-safe, adequate entropy, never repeats |
| `hashToken` | SHA-256 hex digest, deterministic, never returns plaintext, matches the digest Postgres produces for the seeded tokens |
| `secureCompare` | Accepts identical strings; rejects differing strings, differing lengths without throwing, and the empty string against a real secret |

The Postgres cross-check matters: if the application's hash and the migration's
hash ever disagree, every seeded login breaks at once.

### `tests/case-scope.test.ts` — 6 tests

`resolveCaseScope` decides which cases a caller may read.

- An ordinary CHW is restricted to their own cases.
- A `region` query parameter from an ordinary CHW is ignored.
- A supervisor is scoped to their own region by default, may restate their own
  region, and is refused another region.
- An empty region is refused rather than treated as absent.

That last case is the interesting one: treating `region=''` as "no filter" would
have widened a supervisor's scope to every region.

### `tests/geo.test.ts` — 9 tests

| Group | Covers |
|---|---|
| `haversineKm` | Zero for identical points, matches a known distance, symmetric, no NaN across the antimeridian, half the circumference for antipodes |
| `coarsenCoordinate` | Rounds to a ~1.1 km grid, keeps negative coordinates negative, discards precision that could identify a household |
| `scoreToTriage` | Maps scores onto the documented bands |

Triage bands (`backend/src/lib/supabase.ts`):

| Risk score | Level |
|---|---|
| ≥ 75 | `urgent` |
| ≥ 50 | `refer` |
| ≥ 25 | `monitor` |
| < 25 | `healthy` |

### `tests/validation.test.ts` — 17 tests

`decodeImage` accepts PNG, JPEG and WebP, strips a `data:` URL prefix, and
rejects input that is not base64, non-image bytes that decode cleanly, an empty
payload, and an image over the size limit (8 MB by default, `MAX_IMAGE_BYTES`).

A client-supplied MIME type is never trusted; the file signature decides.

## What is not covered

Stated plainly so nobody mistakes a green run for full coverage:

- **No frontend tests.** The frontend is checked by ESLint and a production
  build in CI, not by unit tests.
- **No live-model tests.** Every suite runs in mock mode, so prompt changes and
  real model output are not exercised.
- **No database integration tests.** Supabase is not contacted; `resolveCaseScope`
  is tested as a pure function, not against real row-level behaviour.
- **No VM lifecycle tests.** Provisioning is covered only at the auth boundary.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`,
with `cancel-in-progress` concurrency so a newer push supersedes an in-flight
run.

**Backend job:** `npm ci` → `lint` → `typecheck` → `test` → `build` → boot check.

The boot check starts `node dist/index.js` in mock mode and polls
`/api/health` for up to 20 seconds. `npm run build` succeeding is not the same
as `npm start` working: a module-format mismatch only shows up at runtime.

**Frontend job:** `npm ci` → `lint` → `build`.

## Related

- [How to run the tests](howto-run-tests.md)
- [Contributing](CONTRIBUTING.md)
- [Why the app fails towards "refer"](explanation-safety-model.md)
