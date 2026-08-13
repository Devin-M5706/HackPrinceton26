/**
 * Bearer-token authentication for community health workers.
 *
 * Tokens are opaque random strings issued at first sign-in. Only their
 * SHA-256 digest is stored, so a dump of the `chws` table does not yield
 * usable credentials. Lookup is by digest, which is an indexed equality match
 * on a value the attacker cannot construct without the token itself — there is
 * no secret comparison to time-attack.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { forbidden, unauthorized } from './errors';
import { createLogger } from './logger';
import { supabase, type Chw, type ChwRole } from './supabase';

const log = createLogger('auth');

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      chw?: Chw;
    }
  }
}

/** The single token accepted in mock mode. */
const DEMO_TOKEN = 'demo';

const DEMO_CHW: Chw = Object.freeze({
  id: '11111111-0000-0000-0000-000000000001',
  name: 'Demo CHW',
  region: 'zinder',
  language: 'english',
  auth_token_hash: hashToken(DEMO_TOKEN),
  role: 'chw',
  phone: null,
  created_at: '1970-01-01T00:00:00.000Z',
});

// ── Token helpers ────────────────────────────────────────────────────────────

/** Mint a new bearer token. 32 random bytes, URL-safe. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest — what actually gets stored in `chws.auth_token_hash`. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Compare two strings without leaking their contents through timing.
 * Used for the shared internal secret, which *is* compared directly.
 */
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, so equalise first. The length
  // itself is not sensitive; the contents are.
  if (bufA.length !== bufB.length) {
    // Still perform a comparison so the failure path costs the same.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

// ── Middleware ───────────────────────────────────────────────────────────────

/**
 * Require a valid CHW bearer token; attaches `req.chw`.
 *
 * In mock mode only the literal token `demo` is accepted. The previous
 * behaviour — accepting *any* token whenever Supabase was unconfigured — meant
 * a deployment that lost its database credentials silently became an open API.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearer(req);
    if (!token) {
      throw unauthorized('Missing Bearer token');
    }

    if (config.MOCK_MODE) {
      if (!secureCompare(token, DEMO_TOKEN)) {
        throw unauthorized('Invalid token');
      }
      req.chw = DEMO_CHW;
      next();
      return;
    }

    const { data, error } = await supabase()
      .from('chws')
      .select('*')
      .eq('auth_token_hash', hashToken(token))
      .maybeSingle();

    if (error) {
      log.error('Token lookup failed', { code: error.code });
      throw unauthorized('Invalid token');
    }
    if (!data) {
      throw unauthorized('Invalid token');
    }

    req.chw = data;
    next();
  } catch (err) {
    next(err);
  }
}

/** Require the authenticated CHW to hold one of the given roles. */
export function requireRole(...roles: ChwRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const chw = req.chw;
    if (!chw) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(chw.role)) {
      next(forbidden('Insufficient privileges'));
      return;
    }
    next();
  };
}

/**
 * Require the shared machine-to-machine secret.
 *
 * Guards endpoints the surveillance VM and operators call: dispatching alerts
 * and starting the VM. Without this the start endpoint let any anonymous
 * caller provision billable infrastructure.
 */
export function requireInternalSecret(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const expected = config.ORCHESTRATOR_INTERNAL_SECRET;
  if (!expected) {
    next(forbidden('Internal endpoints are disabled — no shared secret configured'));
    return;
  }

  const provided = req.headers['x-internal-secret'];
  if (typeof provided !== 'string' || !secureCompare(provided, expected)) {
    next(unauthorized('Invalid internal secret'));
    return;
  }

  next();
}

export { DEMO_CHW, DEMO_TOKEN };
