/**
 * Server entry point.
 *
 * Binds the HTTP port, optionally starts the surveillance agent, and shuts
 * both down cleanly on a signal. The Express app itself lives in app.ts.
 */

import type { Server } from 'http';
import { config } from './config';
import { createApp } from './app';
import { createLogger, describeError } from './lib/logger';
import { startSurveillance, stopSurveillance } from './lib/surveillance';

const log = createLogger('server');

/** How long to let in-flight requests finish before forcing exit. */
const SHUTDOWN_GRACE_MS = 15_000;

const app = createApp();

function start(): Server {
  const server = app.listen(config.PORT, () => {
    log.info('Listening', {
      port: config.PORT,
      env: config.NODE_ENV,
      mock_mode: config.MOCK_MODE,
    });
  });

  // The surveillance agent needs a long-lived process and an address the VM
  // can post back to, so it is opt-in via ORCHESTRATOR_URL rather than
  // something every local `npm run dev` provisions a billable VM for.
  if (!config.MOCK_MODE && config.ORCHESTRATOR_URL) {
    startSurveillance().catch((err: unknown) =>
      log.error('Surveillance agent did not start', describeError(err)),
    );
  } else {
    log.info('Surveillance agent not started', {
      reason: config.MOCK_MODE ? 'mock mode' : 'ORCHESTRATOR_URL not set',
    });
  }

  return server;
}

/**
 * Close the listener, then release remote resources.
 *
 * The previous shutdown path destroyed VMs but never closed the server, so
 * `process.exit(0)` cut off in-flight requests mid-response.
 */
function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    void (async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info(`${signal} received — shutting down`);

      const force = setTimeout(() => {
        log.error('Graceful shutdown timed out — forcing exit');
        process.exit(1);
      }, SHUTDOWN_GRACE_MS);
      force.unref();

      try {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
        await stopSurveillance();
        clearTimeout(force);
        log.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        log.error('Error during shutdown', describeError(err));
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // A rejection reaching this point means a bug: something escaped the route
  // wrapper. Log it loudly rather than letting Node exit silently.
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', describeError(reason));
  });

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception — exiting', describeError(err));
    process.exit(1);
  });
}

// Vercel imports this module for its serverless handler; only bind a port when
// executed directly.
if (require.main === module) {
  installShutdownHandlers(start());
}

export { app, createApp };
export default app;
