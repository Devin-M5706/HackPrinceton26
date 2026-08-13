/**
 * Surveillance agent lifecycle.
 *
 * Provisions one persistent Dedalus VM running `SURVEILLANCE_AGENT` in a loop:
 * it polls the case table, clusters recent cases geographically, and posts an
 * alert back to this server when a cluster crosses the threshold.
 *
 * State lives in module memory, so it only survives as long as the process. On
 * a long-lived host the agent is started at boot; on serverless, call
 * POST /api/health/surveillance/start once after deploying.
 */

import { config } from '../config';
import { SURVEILLANCE_AGENT } from './agentScripts';
import { createVm, destroyVm, startDetachedScript } from './dedalus';
import { createLogger, describeError } from './logger';

const log = createLogger('surveillance');

const LOG_PATH = '/home/machine/surveillance.log';

export interface SurveillanceStatus {
  running: boolean;
  machineId: string | null;
  startedAt: string | null;
  error: string | null;
}

const state: SurveillanceStatus = {
  running: false,
  machineId: null,
  startedAt: null,
  error: null,
};

/** In-flight start, so concurrent callers share one attempt. */
let starting: Promise<void> | null = null;

export function getSurveillanceStatus(): SurveillanceStatus {
  return { ...state };
}

/**
 * Provision the VM and launch the agent.
 *
 * Resolves once the agent has actually been launched, and marks `running` only
 * then. The previous version set `running = true` optimistically before the
 * launch request completed, so a failed start still reported healthy and the
 * VM silently did nothing.
 */
export async function startSurveillance(): Promise<void> {
  if (state.running) return;
  if (starting) return starting;

  starting = (async () => {
    state.error = null;

    if (!config.supabaseConfigured) {
      throw new Error('Surveillance requires Supabase credentials');
    }
    if (!config.ORCHESTRATOR_URL || !config.ORCHESTRATOR_INTERNAL_SECRET) {
      throw new Error(
        'Surveillance requires ORCHESTRATOR_URL and ORCHESTRATOR_INTERNAL_SECRET ' +
          'so the agent can post alerts back',
      );
    }

    log.info('Provisioning surveillance VM');
    const machineId = await createVm();

    try {
      await startDetachedScript({
        machineId,
        script: SURVEILLANCE_AGENT,
        logPath: LOG_PATH,
        env: {
          SUPABASE_URL: config.SUPABASE_URL!,
          SUPABASE_KEY: config.SUPABASE_SERVICE_ROLE_KEY!,
          ORCHESTRATOR_URL: config.ORCHESTRATOR_URL!,
          ORCHESTRATOR_INTERNAL_SECRET: config.ORCHESTRATOR_INTERNAL_SECRET!,
        },
      });
    } catch (err) {
      // Do not leave a billable machine running with no agent on it.
      await destroyVm(machineId);
      throw err;
    }

    state.machineId = machineId;
    state.startedAt = new Date().toISOString();
    state.running = true;
    log.info('Surveillance agent started', { machineId });
  })();

  try {
    await starting;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    state.running = false;
    state.machineId = null;
    state.startedAt = null;
    log.error('Surveillance start failed', describeError(err));
    throw err;
  } finally {
    starting = null;
  }
}

/** Tear the VM down. Called on graceful shutdown. */
export async function stopSurveillance(): Promise<void> {
  const machineId = state.machineId;
  if (!machineId) return;

  state.running = false;
  state.machineId = null;
  state.startedAt = null;

  await destroyVm(machineId);
}
