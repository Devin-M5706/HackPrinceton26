/**
 * GET /api/cases         — paginated case list with optional filters
 * GET /api/cases/:id     — single case detail
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export const casesRouter = Router();

casesRouter.use(requireAuth);

// GET /api/cases?region=&since=&page=&limit=
casesRouter.get('/', async (req: Request, res: Response) => {
  const chw = req.chw!;
  const { region, since, page = '1', limit = '20' } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;

  let query = supabase()
    .from('cases')
    .select('*, chws(name, region), clinics(name, contact)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (!chw.region.includes('supervisor')) {
    query = query.eq('chw_id', chw.id);
  } else if (region) {
    query = query.eq('chws.region', region);
  }

  if (since) {
    query = query.gte('created_at', since);
  }

  const { data, error, count } = await query;

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({
    data: data ?? [],
    meta: { page: pageNum, limit: limitNum, total: count ?? 0 },
  });
});

// GET /api/cases/:id
casesRouter.get('/:id', async (req: Request, res: Response) => {
  const chw = req.chw!;

  const { data, error } = await supabase()
    .from('cases')
    .select('*, chws(name, region), clinics(name, contact, lat, lng)')
    .eq('id', req.params.id)
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }

  const row = data as { chw_id: string; [key: string]: unknown };

  if (!chw.region.includes('supervisor') && row.chw_id !== chw.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  res.json(row);
});
