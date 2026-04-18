/**
 * GET /api/health   — system health check
 * Also exposes POST /api/health/surveillance/start to spin VM 4 on demand.
 */

import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";
import { poolStatus } from "../lib/vmPool";
import { startSurveillance, getSurveillanceStatus } from "../lib/surveillance";
import {
  dispatchAlertNotifications,
  iMessageSubscriberCount,
  type AlertPayload,
} from "../lib/notify";

export const healthRouter = Router();

// GET /api/health — no auth required (monitoring friendly)
healthRouter.get("/", async (_req: Request, res: Response) => {
  const pool = poolStatus();
  const surveillance = getSurveillanceStatus();

  // Lightweight DB ping — skip if Supabase not configured
  let dbOk = false;
  let lastAlertAt: string | null = null;

  if (process.env.SUPABASE_URL) {
    try {
      const { error } = await supabase().from("alerts").select("id").limit(1);
      dbOk = !error;
    } catch {
      dbOk = false;
    }

    try {
      const { data } = await supabase()
        .from("alerts")
        .select("fired_at")
        .order("fired_at", { ascending: false })
        .limit(1)
        .single();
      lastAlertAt = (data as { fired_at: string } | null)?.fired_at ?? null;
    } catch {
      /* ignore */
    }
  }

  const healthy = pool.ready || process.env.MOCK_MODE === "true";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    mock_mode: process.env.MOCK_MODE === "true",
    supabase: { connected: dbOk, configured: !!process.env.SUPABASE_URL },
    vm_pool: pool,
    surveillance,
    last_alert_at: lastAlertAt,
    notifications: {
      whatsapp_configured: !!(
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_ACCESS_TOKEN
      ),
      imessage_configured: !!(
        process.env.PHOTON_PROJECT_ID && process.env.PHOTON_PROJECT_SECRET
      ),
      imessage_subscribers: iMessageSubscriberCount(),
    },
  });
});

// POST /api/health/surveillance/start — manually spin VM 4
healthRouter.post(
  "/surveillance/start",
  async (_req: Request, res: Response) => {
    const status = getSurveillanceStatus();
    if (status.running) {
      res.json({ message: "Surveillance already running", status });
      return;
    }

    try {
      await startSurveillance();
      res.json({
        message: "Surveillance agent started",
        status: getSurveillanceStatus(),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

// POST /api/health/notify — internal endpoint called by VM 4 to dispatch iMessage alerts
// Protected by a shared secret so it is not accessible to external callers.
healthRouter.post("/notify", async (req: Request, res: Response) => {
  const secret = req.headers["x-internal-secret"];
  const expected = process.env.ORCHESTRATOR_INTERNAL_SECRET;

  if (!expected || secret !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const payload = req.body as AlertPayload;

  if (
    typeof payload.region !== "string" ||
    typeof payload.case_count !== "number" ||
    typeof payload.radius_km !== "number" ||
    typeof payload.center_lat !== "number" ||
    typeof payload.center_lng !== "number"
  ) {
    res.status(400).json({ error: "Invalid alert payload" });
    return;
  }

  // Dispatch asynchronously — respond immediately so VM 4 is not held up
  dispatchAlertNotifications(payload).catch((err: Error) =>
    console.error("[health/notify] Dispatch error:", err.message),
  );

  res.json({ queued: true, channels: ["whatsapp", "imessage"] });
});
