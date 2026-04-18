/**
 * Surveillance VM 4 manager.
 *
 * Spins a single persistent Dedalus VM running surveillanceAgent.py in an
 * infinite loop.  The VM ID is kept in module state (survives for the lifetime
 * of the Node process, which is the whole point of using a persistent VM).
 *
 * On Vercel: call POST /api/health/surveillance/start once after deploy.
 * On a long-lived process (local / Dedalus VM): called automatically at startup.
 */

import { createVm } from "./dedalus";
import { SURVEILLANCE_AGENT } from "./agentScripts";

interface SurveillanceStatus {
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

export function getSurveillanceStatus(): SurveillanceStatus {
  return { ...state };
}

export async function startSurveillance(): Promise<void> {
  if (state.running) return;

  state.error = null;
  console.log("[surveillance] Creating persistent VM 4…");

  const machineId = await createVm();
  state.machineId = machineId;
  state.startedAt = new Date().toISOString();

  // Encode script and start it detached — we don't await this execution
  // because it runs forever.  Dedalus will keep it alive on the VM.
  const b64Script = Buffer.from(SURVEILLANCE_AGENT).toString("base64");
  const envExports = buildEnvExports({
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    // WhatsApp Cloud API (Meta) — VM 4 fires these directly via HTTP
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    WHATSAPP_ALERT_TO_NUMBER: process.env.WHATSAPP_ALERT_TO_NUMBER ?? "",
    // Orchestrator callback — VM 4 POSTs here to trigger iMessage via Photon Spectrum
    ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL ?? "",
    ORCHESTRATOR_INTERNAL_SECRET:
      process.env.ORCHESTRATOR_INTERNAL_SECRET ?? "",
  });

  const command = `${envExports}; echo ${b64Script} | base64 -d > /tmp/surveillance.py && nohup python3 /tmp/surveillance.py >> /home/machine/surveillance.log 2>&1 &`;

  // Fire-and-forget — we don't wait for completion (it never completes)
  const dcsBase = process.env.DEDALUS_DCS_URL ?? "https://dcs.dedaluslabs.ai";
  fetch(`${dcsBase}/v1/machines/${machineId}/executions`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.DEDALUS_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      command: ["/bin/bash", "-c", command],
      timeout_ms: 10_000, // Just enough to launch nohup; process continues independently
    }),
  })
    .then(() => {
      state.running = true;
      console.log(`[surveillance] VM 4 (${machineId}) started successfully`);
    })
    .catch((err: Error) => {
      state.error = err.message;
      console.error("[surveillance] Failed to start agent:", err.message);
    });

  // Optimistically mark running — the nohup launch is near-instant
  state.running = true;
}

function buildEnvExports(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
    .join("; ");
}
