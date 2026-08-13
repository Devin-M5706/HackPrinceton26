/**
 * Case records.
 *
 *   GET /api/cases/map  — public, de-identified points for the surveillance map
 *   GET /api/cases      — authenticated, paginated list scoped to the caller
 *   GET /api/cases/:id  — authenticated, single case
 *
 * `cases` rows are patient records. The service-role key bypasses row-level
 * security, so scoping is enforced here: a `chw` sees only their own cases, a
 * `supervisor` sees their whole region.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth';
import { asyncHandler, forbidden, notFound } from '../lib/errors';
import { config } from '../config';
import { coarsenCoordinate, supabase, type Chw } from '../lib/supabase';
import { paginationSchema, parseOrThrow } from '../lib/validation';

export const casesRouter = Router();

const MAP_POINT_LIMIT = 500;

/**
 * Decide which cases a caller may list.
 *
 * Extracted so the rule can be unit tested without a database — this is the
 * only thing standing between one health worker and every other worker's
 * patient records, since the service-role key bypasses row-level security.
 *
 * @throws AppError 403 if a supervisor asks for a region that is not theirs
 */
export function resolveCaseScope(
  chw: Pick<Chw, 'id' | 'role' | 'region'>,
  requestedRegion: string | undefined,
): { column: 'region' | 'chw_id'; value: string } {
  if (chw.role === 'supervisor') {
    // The `region` parameter may only restate the supervisor's own region.
    // Honouring an arbitrary value would let any supervisor read patient
    // records from every other region by changing a query string.
    if (requestedRegion !== undefined && requestedRegion !== chw.region) {
      throw forbidden('You can only view cases in your own region');
    }
    return { column: 'region', value: chw.region };
  }

  // Ordinary CHWs see only the cases they filed; `region` is ignored.
  return { column: 'chw_id', value: chw.id };
}

/**
 * GET /api/cases/map — unauthenticated feed for the public case map.
 *
 * This endpoint is deliberately de-identified. It previously returned exact
 * coordinates, the reporting CHW's name and the child's age, which together
 * identify a specific sick child in a small village. It now returns only what
 * a choropleth needs: coordinates rounded to a ~1.1 km grid, the stage, the
 * triage level, the region and the date. No identifiers, no ages, no notes.
 */
casesRouter.get(
  '/map',
  asyncHandler(async (_req: Request, res: Response) => {
    // Without a database there are simply no reported cases. Returning an
    // empty feed lets the public map render its historical layer instead of
    // showing an error, which is what a mock-mode demo should do.
    if (!config.supabaseConfigured) {
      res.json({ data: [], summary: { total: 0, urgent: 0, refer: 0 } });
      return;
    }

    const { data, error } = await supabase()
      .from('cases')
      .select('lat, lng, stage, triage, region, created_at')
      .neq('lat', 0)
      .neq('lng', 0)
      .order('created_at', { ascending: false })
      .limit(MAP_POINT_LIMIT);

    if (error) throw new Error(`Case map query failed: ${error.message}`);

    const points = (data ?? []).map((c) => ({
      lat: coarsenCoordinate(c.lat),
      lng: coarsenCoordinate(c.lng),
      stage: c.stage,
      triage: c.triage,
      region: c.region,
      created_at: c.created_at,
    }));

    // Counts the public dashboard shows, computed server-side so no per-case
    // row needs to leave the boundary to produce them.
    const summary = {
      total: points.length,
      urgent: points.filter((p) => p.triage === 'urgent').length,
      refer: points.filter((p) => p.triage === 'refer').length,
    };

    res.json({ data: points, summary });
  }),
);

// Everything below requires a valid CHW token.
casesRouter.use(requireAuth);

// GET /api/cases?page=&limit=&since=&region=
casesRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const chw = req.chw!;
    const { page, limit, since, region } = parseOrThrow(
      paginationSchema,
      req.query,
      'query parameters',
    );

    const from = (page - 1) * limit;

    let query = supabase()
      .from('cases')
      .select('*, clinics(name, contact)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    const scope = resolveCaseScope(chw, region);
    query = query.eq(scope.column, scope.value);

    if (since) query = query.gte('created_at', since);

    const { data, error, count } = await query;
    if (error) throw new Error(`Case list query failed: ${error.message}`);

    res.json({
      data: data ?? [],
      meta: { page, limit, total: count ?? 0 },
    });
  }),
);

// GET /api/cases/:id
casesRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const chw = req.chw!;
    const id = parseOrThrow(z.string().uuid(), req.params.id, 'case id');

    const { data, error } = await supabase()
      .from('cases')
      .select('*, clinics(name, contact, lat, lng)')
      .eq('id', id)
      .maybeSingle();

    // A case that exists but belongs to someone else returns 404, not 403, so
    // the endpoint cannot be used to probe which case IDs are real.
    if (error || !data) throw notFound('Case not found');

    const visible =
      chw.role === 'supervisor' ? data.region === chw.region : data.chw_id === chw.id;

    if (!visible) throw notFound('Case not found');

    res.json(data);
  }),
);
