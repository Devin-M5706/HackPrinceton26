/**
 * Express application.
 *
 * Kept separate from `index.ts` so the app can be imported by tests and by a
 * serverless handler without binding a port or starting background work.
 */

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config } from './config';
import { AppError } from './lib/errors';
import { createLogger, describeError } from './lib/logger';
import { authLimiter, globalLimiter, screenLimiter } from './lib/rateLimit';
import { alertsRouter } from './routes/alerts';
import { authRouter } from './routes/auth';
import { casesRouter } from './routes/cases';
import { clinicsRouter } from './routes/clinics';
import { healthRouter } from './routes/health';
import { screenRouter } from './routes/screen';

const log = createLogger('http');

/**
 * Request body ceiling.
 *
 * Base64 inflates by ~4/3, and the image limit is enforced precisely after
 * decoding (see `decodeImage`). This is the coarse guard that stops a hostile
 * body being buffered at all.
 */
const BODY_LIMIT_BYTES = Math.ceil((config.MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024;

function corsOptions(): CorsOptions {
  const allowed = config.CORS_ORIGINS;

  // With no allowlist configured (local development) reflect the request
  // origin. The production guard in config.ts makes this unreachable in prod.
  if (allowed.length === 0) {
    return {
      origin: true,
      allowedHeaders: ['Authorization', 'Content-Type'],
      methods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    };
  }

  return {
    origin(origin, callback) {
      // Same-origin and non-browser callers send no Origin header.
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new AppError(403, 'cors_denied', 'Origin not allowed'));
    },
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 600,
  };
}

export function createApp(): Express {
  const app = express();

  // Behind Vercel / a load balancer, req.ip must come from X-Forwarded-For or
  // every client shares one rate-limit bucket. Trust exactly one proxy hop;
  // `true` would let a client spoof its own address via the header.
  app.set('trust proxy', config.isProduction ? 1 : false);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: BODY_LIMIT_BYTES }));
  app.use(globalLimiter);

  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/screen', screenLimiter, screenRouter);
  app.use('/api/cases', casesRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/clinics', clinicsRouter);
  app.use('/api/health', healthRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found', code: 'not_found' });
  });

  app.use(errorHandler);

  return app;
}

/**
 * Central error handler.
 *
 * Clients get a stable `code` and a safe message; everything else stays in the
 * logs. Unexpected errors are never echoed back, because their messages carry
 * database identifiers, provider responses and file paths.
 */
function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      log.error(err.message, { code: err.code, path: req.path, ...err.meta });
    } else {
      log.warn(err.message, { code: err.code, path: req.path });
    }
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }

  if (err instanceof ZodError) {
    log.warn('Schema validation failed', { path: req.path });
    res.status(400).json({ error: 'Invalid request', code: 'bad_request' });
    return;
  }

  // express.json() rejects malformed or oversized bodies with these.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Malformed JSON body', code: 'bad_request' });
    return;
  }
  if (typeof err === 'object' && err !== null && 'type' in err) {
    if ((err as { type: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large', code: 'payload_too_large' });
      return;
    }
  }

  log.error('Unhandled error', { path: req.path, ...describeError(err) });
  res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
}
