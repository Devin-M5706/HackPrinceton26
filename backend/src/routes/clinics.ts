/**
 * GET /api/clinics — facility directory with optional proximity filtering.
 *
 * Distance is computed in application code because the Supabase free tier has
 * no PostGIS. The table is small (hundreds of rows), so a full scan plus an
 * in-memory haversine is cheaper than the complexity of a bounding-box query.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../lib/auth';
import { asyncHandler } from '../lib/errors';
import { haversineKm, supabase, type Clinic } from '../lib/supabase';
import { clinicsQuerySchema, parseOrThrow } from '../lib/validation';

export const clinicsRouter = Router();

clinicsRouter.use(requireAuth);

interface ClinicWithDistance extends Clinic {
  distance_km: number;
}

clinicsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const query = parseOrThrow(clinicsQuerySchema, req.query, 'query parameters');

    let builder = supabase().from('clinics').select('*');
    if (query.noma_capable) builder = builder.eq('noma_capable', true);

    const { data, error } = await builder;
    if (error) throw new Error(`Clinic query failed: ${error.message}`);

    const clinics = data ?? [];

    // The schema guarantees these three arrive together or not at all.
    if (query.lat === undefined || query.lng === undefined || query.radius_km === undefined) {
      res.json({ data: clinics });
      return;
    }

    const withDistance: ClinicWithDistance[] = clinics
      .map((c) => ({
        ...c,
        distance_km:
          Math.round(haversineKm(query.lat!, query.lng!, c.lat, c.lng) * 10) / 10,
      }))
      .filter((c) => c.distance_km <= query.radius_km!)
      .sort((a, b) => a.distance_km - b.distance_km);

    res.json({ data: withDistance });
  }),
);
