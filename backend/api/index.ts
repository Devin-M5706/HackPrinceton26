/**
 * Vercel serverless entry point.
 *
 * Exports the Express app without binding a port or starting background work.
 * `src/index.ts` only calls `listen()` when it is the main module, so importing
 * it here is safe, but going through `createApp` keeps the intent explicit.
 *
 * Caveats for serverless:
 *   - The surveillance agent needs a long-lived process. Provision it once
 *     after deploying with POST /api/health/surveillance/start.
 *   - Rate limits use an in-memory store and so are per-instance here. Use a
 *     shared store if you rely on them.
 */

import { createApp } from '../src/app';

export default createApp();
