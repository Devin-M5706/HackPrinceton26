# lumos.health — orchestrator

Express + TypeScript API: the triage pipeline, case records, and outbreak
surveillance. See the [repository README](../README.md) for setup, deployment
and the API table.

## Layout

```
src/
  config.ts            Validated environment. Fails fast at boot.
  app.ts               Express app: middleware, routes, error handler.
  index.ts             Port binding, startup, graceful shutdown.
  lib/
    auth.ts            Bearer-token auth, token hashing, role and secret guards
    errors.ts          AppError + asyncHandler (Express 4 swallows async throws)
    logger.ts          Structured logging with redaction of sensitive fields
    validation.ts      Zod schemas for client input AND model output
    triage.ts          The three-stage pipeline and its failure behaviour
    supabase.ts        Typed client, row types, geo helpers
    dedalus.ts         VM management (bounded polling, timeouts)
    surveillance.ts    Surveillance VM lifecycle
    agentScripts.ts    Python agent that runs on the VM
    rateLimit.ts       Per-caller limits, keyed on a hash of the token
  routes/              One file per resource
scripts/
  cleanup-vms.ts       Destroy orphaned billable VMs
tests/                 Vitest suites, including access-control regressions
```

## Conventions

**Every async handler is wrapped in `asyncHandler`.** Express 4 does not catch
rejected promises from async middleware: an unwrapped `await` that throws leaves
the request hanging until the client times out and surfaces as an
`unhandledRejection` on the process.

**Never call `process.env` outside `config.ts`.** Values are parsed and validated
once at import time.

**Never log patient data.** The logger redacts a known list of field names
defensively, but the rule is not to pass them in the first place.

**Model output is untrusted input.** Parse it with a Zod schema via
`parseModelJson`, which returns `null` rather than throwing — every caller has a
clinically safe fallback, and a partially-parsed medical result is worse than
none.

**Failure means "refer", not a plausible guess.** When a pipeline stage fails, do
not substitute canned findings. Return empty, flag `degraded`, and let the UI say
the assessment was incomplete.

## Testing

```bash
npm test
```

Tests run in mock mode with no network access. `tests/api.test.ts` drives the
real Express app through supertest and covers the access-control rules —
unauthenticated VM provisioning, arbitrary tokens in mock mode, and unvalidated
alert payloads are all regression cases there.
