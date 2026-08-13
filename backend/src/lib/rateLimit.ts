/**
 * Rate limiting.
 *
 * The default in-memory store is per-process, so limits are per-instance
 * rather than global. That is adequate for a single long-lived host; if this
 * is ever scaled horizontally, swap in a shared store (Redis) so the limits
 * still mean something.
 */

import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { createHash } from 'crypto';
import { config } from '../config';

/** IPv6-safe client key. */
function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '0.0.0.0');
}

/**
 * Bucket key for an authenticated caller.
 *
 * The raw bearer token is hashed before use: rate-limit keys are held in
 * memory, appear in store dumps and can surface in debug output, and a bearer
 * token is a live credential. Falls back to the client IP for anonymous calls.
 */
function callerKey(req: Request): string {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) {
      return `t:${createHash('sha256').update(token).digest('base64url').slice(0, 24)}`;
    }
  }
  return `ip:${ipKey(req)}`;
}

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Tests would otherwise fail on whichever case happens to run 61st.
  skip: () => config.isTest,
};

/**
 * POST /api/screen — the expensive route: three model calls per request,
 * one of them with an image attached. Keyed per CHW.
 */
export const screenLimiter = rateLimit({
  ...shared,
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: callerKey,
  message: {
    error: 'Too many screenings — please wait a few minutes before submitting again.',
  },
});

/**
 * Sign-in — throttled separately and more tightly than general traffic,
 * because each attempt triggers a Firebase token verification.
 */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => `ip:${ipKey(req)}`,
  message: { error: 'Too many sign-in attempts — please wait and try again.' },
});

/** Everything else. Health checks are exempt so monitors never trip it. */
export const globalLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: callerKey,
  message: { error: 'Too many requests — slow down.' },
  skip: (req) => config.isTest || req.path === '/api/health',
});
