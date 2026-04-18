/**
 * GET /api/alerts   — recent outbreak alerts fired by VM 4
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

// GET /api/alerts?days=30
alertsRouter.get('/', async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(1, parseInt((req.query.days as string) ?? '30', 10)));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data, error } = await supabase()
    .from('alerts')
    .select('*')
    .gte('fired_at', since)
    .order('fired_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ data, meta: { days, count: data?.length ?? 0 } });
});
