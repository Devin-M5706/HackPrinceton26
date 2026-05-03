import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../../.env") });
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { authRouter } from "./routes/auth";
import { screenRouter } from "./routes/screen";
import { casesRouter } from "./routes/cases";
import { alertsRouter } from "./routes/alerts";
import { clinicsRouter } from "./routes/clinics";
import { healthRouter } from "./routes/health";
import { initVmPool, drainVmPool } from "./lib/vmPool";
import { startSurveillance } from "./lib/surveillance";
import { startPhotonListener } from "./lib/notify";
import { globalLimiter, screenLimiter } from "./lib/rateLimit";

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? '*',
  allowedHeaders: ['Authorization', 'Content-Type'],
}));
app.use(express.json({ limit: "20mb" })); // base64 images can be large
app.use(globalLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────

app.use("/api/auth", authRouter);
app.use("/api/screen", screenLimiter, screenRouter);
app.use("/api/cases", casesRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/clinics", clinicsRouter);
app.use("/api/health", healthRouter);

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[server] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

// ── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  app.listen(PORT, () => {
    console.log(`[server] lumos.health orchestrator listening on :${PORT}`);
    console.log(
      `[server] Mock mode: ${process.env.MOCK_MODE === "true" ? "ON" : "OFF"}`,
    );
  });

  // Start Photon Spectrum iMessage listener — registers health authority subscribers
  startPhotonListener().catch((err: Error) =>
    console.error("[startup] Photon Spectrum listener failed:", err.message),
  );

  // Spin up warm VM pool (VMs 1–3) in background — don't block server start
  if (process.env.MOCK_MODE !== "true") {
    initVmPool().catch((err: Error) =>
      console.error("[startup] VM pool init failed:", err.message),
    );

    // Start VM 4 (surveillance) — persistent, never exits
    // NOTE: On Vercel this won't persist across function invocations.
    //       Call POST /api/health/surveillance/start after deploying to Vercel.
    startSurveillance().catch((err: Error) =>
      console.error("[startup] Surveillance agent failed:", err.message),
    );
  } else {
    console.log("[server] MOCK_MODE=true — skipping VM pool and surveillance");
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM — draining VM pool…");
  await drainVmPool();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[server] SIGINT — draining VM pool…");
  await drainVmPool();
  process.exit(0);
});

start();

// Export for Vercel serverless handler
export default app;
