/**
 * Warm VM pool for ephemeral agents (VMs 1–3).
 *
 * Pre-spins POOL_SIZE VMs at server start so the demo never pays cold-start
 * latency during a judge demo. VMs are acquired/released like a semaphore.
 *
 * IMPORTANT: This only works when the server process is long-lived (local dev
 * or a Dedalus VM deployment). On Vercel serverless the pool resets on each
 * cold function invocation — use mock mode or a dedicated VM deployment there.
 */

import { createVm, destroyVm } from './dedalus';

const POOL_SIZE = 3;

interface PoolEntry {
  machineId: string;
  inUse: boolean;
}

const pool: PoolEntry[] = [];
let poolReady = false;
let poolError: Error | null = null;

// ── Init ─────────────────────────────────────────────────────────────────────

/** Call once at server start. Resolves when all VMs are warm and ready. */
export async function initVmPool(): Promise<void> {
  console.log(`[vmPool] Spinning up ${POOL_SIZE} warm VMs…`);
  try {
    const ids = await Promise.all(
      Array.from({ length: POOL_SIZE }, () => createVm()),
    );
    for (const machineId of ids) {
      pool.push({ machineId, inUse: false });
    }
    poolReady = true;
    console.log(`[vmPool] Pool ready: ${ids.join(', ')}`);
  } catch (err) {
    poolError = err as Error;
    console.error('[vmPool] Failed to initialise pool:', poolError.message);
    console.warn('[vmPool] Falling back to on-demand VM creation (slower)');
  }
}

/** Tear down all VMs in the pool. Call on graceful shutdown. */
export async function drainVmPool(): Promise<void> {
  await Promise.all(pool.map((e) => destroyVm(e.machineId)));
  pool.length = 0;
  poolReady = false;
}

// ── Acquire / Release ─────────────────────────────────────────────────────────

/**
 * Acquire a warm VM from the pool.
 * Falls back to creating a fresh VM if the pool is exhausted or not ready.
 */
export async function acquireVm(): Promise<{ machineId: string; fromPool: boolean }> {
  if (poolReady) {
    const entry = pool.find((e) => !e.inUse);
    if (entry) {
      entry.inUse = true;
      return { machineId: entry.machineId, fromPool: true };
    }
    // Pool exhausted — create on demand
    console.warn('[vmPool] Pool exhausted, creating on-demand VM');
  }

  const machineId = await createVm();
  return { machineId, fromPool: false };
}

/**
 * Release a VM back to the pool, or destroy it if it was created on demand.
 */
export async function releaseVm(machineId: string, fromPool: boolean): Promise<void> {
  if (fromPool) {
    const entry = pool.find((e) => e.machineId === machineId);
    if (entry) {
      entry.inUse = false;
      return;
    }
  }
  // On-demand VM — destroy to stop billing
  await destroyVm(machineId);
}

export function poolStatus(): { ready: boolean; total: number; available: number; error: string | null } {
  return {
    ready: poolReady,
    total: pool.length,
    available: pool.filter((e) => !e.inUse).length,
    error: poolError?.message ?? null,
  };
}
