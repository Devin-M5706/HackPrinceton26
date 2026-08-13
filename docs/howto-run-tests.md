# How to run the tests

Run the backend test suite and the rest of the quality gates locally, and add a
test of your own.

## Prerequisites

- Node.js 20 or newer (`node --version`)
- Dependencies installed: `cd backend && npm install`

No `.env` file is needed. The suite forces mock mode, so it never contacts
Supabase, a model provider, or a VM.

## Run everything the way CI does

From `backend/`:

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

If all six pass, CI will pass. These are exactly the steps in
`.github/workflows/ci.yml`, plus a boot check described below.

## Run just the tests

```bash
cd backend
npm test
```

Expected output:

```
 ✓ tests/validation.test.ts  (17 tests)
 ✓ tests/auth.test.ts        (10 tests)
 ✓ tests/geo.test.ts          (9 tests)
 ✓ tests/case-scope.test.ts   (6 tests)
 ✓ tests/api.test.ts         (16 tests)

 Test Files  5 passed (5)
      Tests  58 passed (58)
```

## Run a subset

```bash
npm test -- tests/auth.test.ts        # one file
npm test -- -t "rejects an arbitrary token"   # one test by name
npm run test:watch                    # re-run on change
```

## Verify the built server actually boots

`npm run build` succeeding is not the same as `npm start` working — a
module-format mismatch only shows up at runtime. CI checks this, and you can
too:

```bash
cd backend
npm run build
MOCK_MODE=true PORT=3001 node dist/index.js &
curl -fsS http://localhost:3001/api/health
```

You should get JSON with `"mock_mode": true`. Stop the server with `kill %1`.

On Windows PowerShell, set the variables first:

```powershell
$env:MOCK_MODE='true'; $env:PORT='3001'; node dist/index.js
```

## Add a test

Tests live in `backend/tests/` and end in `.test.ts`. Files matching
`src/**/*.test.ts` are picked up too, if you prefer them beside the code.

Pure functions need no setup:

```ts
import { describe, expect, it } from 'vitest';
import { coarsenCoordinate } from '../src/lib/supabase';

describe('coarsenCoordinate', () => {
  it('discards precision that could identify a household', () => {
    expect(coarsenCoordinate(13.512345)).toBe(13.51);
  });
});
```

For a route, drive the real app with supertest rather than calling the handler
directly, so middleware, auth and the error handler are all exercised:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';

describe('GET /api/alerts', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/alerts');
    expect(res.status).toBe(401);
  });
});
```

Two rules worth knowing:

- **Do not set `process.env` inside a test file.** `tests/setup.ts` runs before
  any module imports `src/config`, which reads the environment once at import
  time. Setting it later has no effect.
- **A test that needs different env needs its own file.** The pool is `forks`
  precisely so those suites do not share a worker with the default config.

## Troubleshooting

**`Config validation failed` on startup.** A suite imported `src/config` before
`tests/setup.ts` ran, or you are running a file outside the configured
`setupFiles`. Run through `npm test`, not `npx vitest` against a stray path.

**Tests pass alone but fail together.** Something mutated a module-level
singleton. `restoreMocks` clears mocks but not module state; use
`resetTriageClient()` for the inference client, or move the suite to its own
file.

**`Cannot find module '../src/app'`.** You are running from the repo root. All
test commands run from `backend/`.

**ESLint warns about module type on `eslint.config.js`.** Harmless. The config
is ESM inside a CommonJS package; ESLint reparses it and continues.

## Related

- [Testing reference](reference-testing.md) — what each suite covers
- [Contributing](CONTRIBUTING.md)
