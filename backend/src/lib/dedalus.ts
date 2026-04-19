/**
 * Dedalus Machines (DCS) HTTP client.
 *
 * The `dedalus-labs` npm package is the AI inference SDK (chat/embeddings).
 * The VM management surface lives at https://dcs.dedaluslabs.ai and is accessed
 * via plain fetch — the npm package does not cover machines.
 *
 * Confirmed REST surface (from docs.dedaluslabs.ai/dcs):
 *   POST   /v1/machines                               → create
 *   GET    /v1/machines/:id                            → retrieve (status.phase)
 *   DELETE /v1/machines/:id                            → delete
 *   POST   /v1/machines/:id/executions                 → run command
 *   GET    /v1/machines/:id/executions/:exec_id        → poll status
 *   GET    /v1/machines/:id/executions/:exec_id/output → fetch stdout
 *
 * Auth header: x-api-key (lowercase)
 */

const DCS_BASE = process.env.DEDALUS_DCS_URL ?? 'https://dcs.dedaluslabs.ai';
const API_KEY = () => process.env.DEDALUS_API_KEY!;

const MACHINE_SPEC = { vcpu: 2, memory_mib: 4096, storage_gib: 10 } as const;
const GUEST_AGENT_WAIT_MS = 5000;
const POLL_INTERVAL_MS = 2000;
const EXEC_TIMEOUT_MS = 60_000;

// ── Raw HTTP helpers ──────────────────────────────────────────────────────────

export async function destroyAllVms(): Promise<void> {
  try {
    const machines = await dcsGet<{ machines: { machine_id: string }[] }>('/machines');
    const ids = machines.machines?.map((m) => m.machine_id) ?? [];
    if (ids.length > 0) {
      console.log(`[dedalus] Cleaning up ${ids.length} stale VM(s):`, ids.join(', '));
      await Promise.all(ids.map((id) => dcsDelete(`/machines/${id}`)));
    }
  } catch (err) {
    console.warn('[dedalus] Could not list/clean stale VMs:', (err as Error).message);
  }
}

async function dcsGet<T>(path: string): Promise<T> {
  const res = await fetch(`${DCS_BASE}/v1${path}`, {
    headers: { 'x-api-key': API_KEY() },
  });
  if (!res.ok) throw new Error(`DCS GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function dcsPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${DCS_BASE}/v1${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY(),
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DCS POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function dcsDelete(path: string): Promise<void> {
  const getRes = await fetch(`${DCS_BASE}/v1${path}`, {
    headers: { 'x-api-key': API_KEY() },
  });
  if (!getRes.ok) return;
  const etag = (getRes.headers.get('etag') ?? '').replace(/^W\//, '');

  const res = await fetch(`${DCS_BASE}/v1${path}`, {
    method: 'DELETE',
    headers: {
      'x-api-key': API_KEY(),
      'Idempotency-Key': crypto.randomUUID(),
      'If-Match': etag,
    },
  });
  if (!res.ok && res.status !== 404 && res.status !== 202) {
    throw new Error(`DCS DELETE ${path} → ${res.status}`);
  }
}

// ── DCS types (from docs.dedaluslabs.ai/dcs) ─────────────────────────────────

interface MachineStatus { phase: 'pending' | 'running' | 'failed' | 'terminated' }
interface Machine { machine_id: string; status: MachineStatus }
interface Execution { execution_id: string; status: 'pending' | 'running' | 'succeeded' | 'failed' | 'timed_out' }

// ── VM lifecycle ─────────────────────────────────────────────────────────────

export async function createVm(): Promise<string> {
  const vm = await dcsPost<Machine>('/machines', MACHINE_SPEC);
  await waitForRunning(vm.machine_id);
  return vm.machine_id;
}

async function waitForRunning(machineId: string): Promise<void> {
  while (true) {
    const vm = await dcsGet<Machine>(`/machines/${machineId}`);
    if (vm.status.phase === 'running') break;
    if (vm.status.phase === 'failed') throw new Error(`VM ${machineId} failed to start`);
    await sleep(POLL_INTERVAL_MS);
  }
  // Give the guest agent a moment to initialise inside the VM
  await sleep(GUEST_AGENT_WAIT_MS);
}

export async function destroyVm(machineId: string): Promise<void> {
  try {
    await dcsDelete(`/machines/${machineId}`);
  } catch {
    // Best-effort — don't throw if already gone
  }
}

// ── Script execution ──────────────────────────────────────────────────────────

export interface ExecOptions {
  machineId: string;
  /** Python 3 source code to run on the VM */
  script: string;
  /** Environment variables forwarded into the VM process */
  env: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Base64-encodes the script, writes it to the VM, runs it with python3,
 * and returns stdout.  Throws on failure or timeout.
 */
export async function runScript(opts: ExecOptions): Promise<string> {
  const { machineId, script, env, timeoutMs = EXEC_TIMEOUT_MS } = opts;

  const b64Script = Buffer.from(script).toString('base64');
  const envExports = Object.entries(env)
    .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
    .join('; ');

  const command = `${envExports}; echo ${b64Script} | base64 -d > /tmp/agent.py && python3 /tmp/agent.py`;

  const exec = await dcsPost<Execution>(`/machines/${machineId}/executions`, {
    command: ['/bin/bash', '-c', command],
    timeout_ms: timeoutMs,
  });

  return pollExecution(machineId, exec.execution_id);
}

async function pollExecution(machineId: string, execId: string): Promise<string> {
  while (true) {
    const exec = await dcsGet<Execution>(`/machines/${machineId}/executions/${execId}`);
    if (exec.status === 'succeeded') {
      const out = await dcsGet<{ stdout: string; stderr?: string }>(
        `/machines/${machineId}/executions/${execId}/output`,
      );
      return out.stdout ?? '';
    }
    if (exec.status === 'failed') {
      const out = await dcsGet<{ stdout: string; stderr?: string }>(
        `/machines/${machineId}/executions/${execId}/output`,
      ).catch(() => ({ stdout: '', stderr: 'unknown' }));
      throw new Error(`Execution failed — stderr: ${out.stderr ?? '(none)'} | stdout: ${out.stdout ?? '(none)'}`);
    }
    if (exec.status === 'timed_out') throw new Error('Execution timed out');
    await sleep(POLL_INTERVAL_MS);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
