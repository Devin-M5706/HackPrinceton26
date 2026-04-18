import { Request, Response, NextFunction } from 'express';
import { supabase, Chw } from './supabase';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      chw?: Chw;
    }
  }
}

/**
 * Bearer-token auth middleware.
 *
 * Looks up the `Authorization: Bearer <token>` header in the `chws` table.
 * Attaches `req.chw` on success; returns 401 on failure.
 *
 * For the hackathon, tokens are plain strings stored in `chws.auth_token`.
 * In production you'd use JWTs with Supabase Auth.
 */
const MOCK_CHW: Chw = {
  id: '11111111-0000-0000-0000-000000000001',
  name: 'Demo CHW',
  region: 'zinder',
  language: 'english',
  auth_token: 'demo',
  created_at: new Date().toISOString(),
};

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer token' });
    return;
  }

  // In mock mode with no Supabase configured, accept any token and return a demo CHW
  if (process.env.MOCK_MODE === 'true' && !process.env.SUPABASE_URL) {
    req.chw = MOCK_CHW;
    next();
    return;
  }

  const token = header.slice(7).trim();
  const { data, error } = await supabase()
    .from('chws')
    .select('*')
    .eq('auth_token', token)
    .single();

  if (error || !data) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  req.chw = data as Chw;
  next();
}
