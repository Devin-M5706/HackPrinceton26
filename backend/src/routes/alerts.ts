/**
 * GET /api/alerts — outbreak alerts raised by the surveillance agent.
 *
 * Alerts are cluster-level aggregates (region, case count, centroid) with no
 * patient identifiers, so they are readable by any authenticated CHW.
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../config';
import { requireAuth } from '../lib/auth';
import { asyncHandler } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { alertsQuerySchema, parseOrThrow } from '../lib/validation';

export const alertsRouter = Router();

const DAY_MS = 86_400_000;

alertsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { days } = parseOrThrow(alertsQuerySchema, req.query, 'query parameters');

    if (!config.supabaseConfigured) {
      res.json({ data: [], meta: { days, count: 0 } });
      return;
    }

    const since = new Date(Date.now() - days * DAY_MS).toISOString();

    const { data, error } = await supabase()
      .from('alerts')
      .select('*')
      .gte('fired_at', since)
      .order('fired_at', { ascending: false })
      .limit(500);

    if (error) throw new Error(`Alert query failed: ${error.message}`);

    res.json({ data: data ?? [], meta: { days, count: data?.length ?? 0 } });
  }),
);

/**
 * GET /api/alerts/count — unauthenticated badge count for the public page.
 *
 * Returns a bare number only. The landing page previously called the full
 * alerts endpoint for this, which needed the whole payload to be public.
 */
alertsRouter.get(
  '/count',
  asyncHandler(async (req: Request, res: Response) => {
    const { days } = parseOrThrow(alertsQuerySchema, req.query, 'query parameters');

    if (!config.supabaseConfigured) {
      res.json({ count: 0, days });
      return;
    }

    const since = new Date(Date.now() - days * DAY_MS).toISOString();

    const { count, error } = await supabase()
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .gte('fired_at', since);

    if (error) throw new Error(`Alert count query failed: ${error.message}`);

    res.json({ count: count ?? 0, days });
  }),
);
