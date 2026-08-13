/**
 * Health and operations endpoints.
 *
 *   GET  /api/health                      — public liveness/readiness probe
 *   POST /api/health/surveillance/start   — internal, starts the surveillance VM
 *   POST /api/health/notify               — internal, dispatches an outbreak alert
 *
 * The two POST routes provision billable infrastructure and send messages to
 * real health authorities, so both sit behind the shared internal secret. The
 * start endpoint was previously unauthenticated, which let any anonymous
 * caller spin up VMs.
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../config';
import { requireInternalSecret } from '../lib/auth';
import { asyncHandler } from '../lib/errors';
import { createLogger, describeError } from '../lib/logger';
import { dispatchAlertNotifications } from '../lib/notify';
import { supabase } from '../lib/supabase';
import { getSurveillanceStatus, startSurveillance } from '../lib/surveillance';
import { alertPayloadSchema, parseOrThrow } from '../lib/validation';

const log = createLogger('health');

export const healthRouter = Router();

const DB_PROBE_TIMEOUT_MS = 3000;

/** Resolve to false rather than hang if the database is unreachable. */
async function probeDatabase(): Promise<boolean> {
  if (!config.supabaseConfigured) return false;

  const probe = supabase()
    .from('alerts')
    .select('id', { head: true, count: 'exact' })
    .limit(1)
    .then(({ error }) => !error);

  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(false), DB_PROBE_TIMEOUT_MS).unref?.(),
  );

  try {
    return await Promise.race([probe, timeout]);
  } catch {
    return false;
  }
}

/**
 * GET /api/health — no auth, for uptime monitors and load balancers.
 *
 * Reports only booleans and counts. It must not leak configuration values,
 * machine IDs or error strings, since anyone can call it.
 */
healthRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const dbOk = await probeDatabase();
    const surveillance = getSurveillanceStatus();

    // The process is healthy if it can serve requests. Optional subsystems
    // being down is reported, not fatal — flapping a 503 would make a load
    // balancer pull a server that is still perfectly able to triage.
    const ready = config.MOCK_MODE || dbOk;

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      mock_mode: config.MOCK_MODE,
      dependencies: {
        database: { configured: config.supabaseConfigured, reachable: dbOk },
        inference: { configured: config.dedalusConfigured },
        firebase: { configured: config.firebaseConfigured },
        whatsapp: { configured: config.whatsappConfigured },
      },
      surveillance: {
        running: surveillance.running,
        started_at: surveillance.startedAt,
        healthy: surveillance.error === null,
      },
    });
  }),
);

/** POST /api/health/surveillance/start — provisions the persistent VM. */
healthRouter.post(
  '/surveillance/start',
  requireInternalSecret,
  asyncHandler(async (_req: Request, res: Response) => {
    const current = getSurveillanceStatus();
    if (current.running) {
      res.json({ message: 'Surveillance already running', status: current });
      return;
    }

    await startSurveillance();
    res.json({ message: 'Surveillance agent started', status: getSurveillanceStatus() });
  }),
);

/** POST /api/health/notify — called by the surveillance VM when a cluster fires. */
healthRouter.post(
  '/notify',
  requireInternalSecret,
  asyncHandler(async (req: Request, res: Response) => {
    const payload = parseOrThrow(alertPayloadSchema, req.body, 'alert payload');

    // Acknowledge immediately; the VM should not block on message delivery.
    void dispatchAlertNotifications(payload).catch((err: unknown) =>
      log.error('Alert dispatch failed', describeError(err)),
    );

    res.status(202).json({ queued: true });
  }),
);
