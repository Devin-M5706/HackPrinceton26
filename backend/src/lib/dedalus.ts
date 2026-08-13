/**
 * Dedalus Compute Service (DCS) HTTP client — virtual machine management.
 *
 * The `dedalus-labs` npm package covers model inference only; machines are a
 * separate REST surface reached with plain fetch.
 *
 *   POST   /v1/machines                        create
 *   GET    /v1/machines/:id                    retrieve (status.phase)
 *   DELETE /v1/machines/:id                    delete (requires If-Match)
 *   POST   /v1/machines/:id/executions         run a command
 *   GET    /v1/machines/:id/executions/:eid    poll
 *
 * Every wait loop here is bounded. An unbounded poll against a machine stuck
 * in `pending` would hold a request open indefinitely and leak a billable VM.
 */

import { config } from '../config';
import { createLogger } from './logger';

const log = createLogger('dedalus');

const MACHINE_SPEC = { vcpu: 2, memory_mib: 4096, storage_gib: 10 } as const;

const POLL_INTERVAL_MS = 2000;
const BOOT_TIMEOUT_MS = 120_000;
const EXEC_TIMEOUT_MS = 60_000;
const EXEC_POLL_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Time for the in-VM guest agent to come up after the machine reports running. */
const GUEST_AGENT_WAIT_MS = 5000;

// ── Types ────────────────────────────────────────────────────────────────────

type MachinePhase = 'pending' | 'running' | 'failed' | 'terminated';
type ExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'timed_out';

interface Machine {
  machine_id: string;
  status: { phase: MachinePhase };
}

interface Execution {
  execution_id: string;
  status: ExecutionStatus;
}

interface ExecutionOutput {
  stdout?: string;
  stderr?: string;
}

export interface ExecOptions {
  machineId: string;
  /** Python 3 source to run on the VM. */
  script: string;
  /** Environment variables exported before the script runs. */
  env: Record<string, string>;
  timeoutMs?: number;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function apiKey(): string {
  if (!config.DEDALUS_API_KEY) {
    throw new Error('DEDALUS_API_KEY is not configured');
  }
  return config.DEDALUS_API_KEY;
}

function url(path: string): string {
  return `${config.DEDALUS_DCS_URL}/v1${path}`;
}

async function dcsGet<T>(path: string): Promise<T> {
  const res = await fetch(url(path), {
    headers: { 'x-api-key': apiKey() },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DCS GET ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

async function dcsPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: 'POST',
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DCS POST ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

/** DELETE requires the current ETag, so fetch it first. */
async function dcsDelete(path: string): Promise<void> {
  const current = await fetch(url(path), {
    headers: { 'x-api-key': apiKey() },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (current.status === 404) return;
  if (!current.ok) throw new Error(`DCS GET ${path} returned ${current.status}`);

  const etag = (current.headers.get('etag') ?? '').replace(/^W\//, '');

  const res = await fetch(url(path), {
    method: 'DELETE',
    headers: {
      'x-api-key': apiKey(),
      'Idempotency-Key': crypto.randomUUID(),
      ...(etag ? { 'If-Match': etag } : {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok && res.status !== 404 && res.status !== 202) {
    throw new Error(`DCS DELETE ${path} returned ${res.status}`);
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

// ── Machine lifecycle ────────────────────────────────────────────────────────

/** List every machine on the account. */
export async function listVms(): Promise<string[]> {
  const res = await dcsGet<{ machines?: { machine_id: string }[] }>('/machines');
  return (res.machines ?? []).map((m) => m.machine_id);
}

/**
 * Destroy every machine on the account.
 *
 * Blunt instrument — only safe because this account runs nothing else. Used by
 * the cleanup script, not at server startup.
 */
export async function destroyAllVms(): Promise<void> {
  let ids: string[];
  try {
    ids = await listVms();
  } catch (err) {
    log.warn('Could not list machines for cleanup', {
      message: (err as Error).message,
    });
    return;
  }

  if (ids.length === 0) return;

  log.info(`Destroying ${ids.length} machine(s)`);
  await Promise.allSettled(ids.map((id) => destroyVm(id)));
}

/** Create a machine and wait for it to reach `running`. */
export async function createVm(): Promise<string> {
  const machine = await dcsPost<Machine>('/machines', MACHINE_SPEC);
  try {
    await waitForRunning(machine.machine_id);
  } catch (err) {
    // Never leave a half-booted machine billing.
    await destroyVm(machine.machine_id);
    throw err;
  }
  return machine.machine_id;
}

async function waitForRunning(machineId: string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const machine = await dcsGet<Machine>(`/machines/${machineId}`);

    if (machine.status.phase === 'running') {
      await sleep(GUEST_AGENT_WAIT_MS);
      return;
    }
    if (machine.status.phase === 'failed' || machine.status.phase === 'terminated') {
      throw new Error(`Machine ${machineId} entered phase "${machine.status.phase}"`);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Machine ${machineId} did not start within ${BOOT_TIMEOUT_MS}ms`);
}

/** Destroy a machine. Best-effort — never throws. */
export async function destroyVm(machineId: string): Promise<void> {
  try {
    await dcsDelete(`/machines/${machineId}`);
    log.info('Machine destroyed', { machineId });
  } catch (err) {
    log.warn('Machine cleanup failed', {
      machineId,
      message: (err as Error).message,
    });
  }
}

// ── Script execution ─────────────────────────────────────────────────────────

/** Single-quote a value for safe interpolation into a bash command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Render `export K='v'; …` for a set of environment variables. */
export function buildEnvExports(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('; ');
}

/**
 * Write a Python script to the VM and run it, returning stdout.
 *
 * The script is base64-encoded rather than interpolated so its contents cannot
 * terminate the surrounding shell command.
 */
export async function runScript(opts: ExecOptions): Promise<string> {
  const { machineId, script, env, timeoutMs = EXEC_TIMEOUT_MS } = opts;

  const encoded = Buffer.from(script, 'utf8').toString('base64');
  const command = `${buildEnvExports(env)}; echo ${encoded} | base64 -d > /tmp/agent.py && python3 /tmp/agent.py`;

  const exec = await dcsPost<Execution>(`/machines/${machineId}/executions`, {
    command: ['/bin/bash', '-c', command],
    timeout_ms: timeoutMs,
  });

  return pollExecution(machineId, exec.execution_id);
}

/** Launch a script detached with nohup and return once it has been started. */
export async function startDetachedScript(opts: {
  machineId: string;
  script: string;
  env: Record<string, string>;
  logPath: string;
}): Promise<void> {
  const encoded = Buffer.from(opts.script, 'utf8').toString('base64');
  const command =
    `${buildEnvExports(opts.env)}; ` +
    `echo ${encoded} | base64 -d > /tmp/agent.py && ` +
    `nohup python3 /tmp/agent.py >> ${shellQuote(opts.logPath)} 2>&1 &`;

  // Short timeout: this only needs to outlive the nohup fork, after which the
  // process keeps running independently of the execution record.
  await dcsPost<Execution>(`/machines/${opts.machineId}/executions`, {
    command: ['/bin/bash', '-c', command],
    timeout_ms: 10_000,
  });
}

async function pollExecution(machineId: string, execId: string): Promise<string> {
  const deadline = Date.now() + EXEC_POLL_TIMEOUT_MS;
  const outputPath = `/machines/${machineId}/executions/${execId}/output`;

  while (Date.now() < deadline) {
    const exec = await dcsGet<Execution>(`/machines/${machineId}/executions/${execId}`);

    if (exec.status === 'succeeded') {
      const out = await dcsGet<ExecutionOutput>(outputPath);
      return out.stdout ?? '';
    }

    if (exec.status === 'failed') {
      const out = await dcsGet<ExecutionOutput>(outputPath).catch(
        (): ExecutionOutput => ({}),
      );
      throw new Error(`Execution failed: ${out.stderr?.slice(0, 500) ?? '(no stderr)'}`);
    }

    if (exec.status === 'timed_out') {
      throw new Error('Execution timed out on the VM');
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Execution ${execId} did not finish within ${EXEC_POLL_TIMEOUT_MS}ms`);
}
