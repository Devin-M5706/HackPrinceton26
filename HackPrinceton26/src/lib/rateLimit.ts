import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? '127.0.0.1');

/**
 * POST /api/screen — the expensive route.
 * Spins 3 VMs + 3 Kimi calls per request.
 * Keyed by Bearer token so each CHW gets their own bucket.
 * 5 requests per CHW per 10 minutes.
 */
export const screenLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => req.headers.authorization ?? ipKey(req),
  message: { error: 'Too many screenings — wait 10 minutes before submitting again.' },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/**
 * Global limiter — all routes.
 * 60 requests per IP per minute. Health endpoint is exempt.
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => ipKey(req),
  message: { error: 'Too many requests — slow down.' },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
});
