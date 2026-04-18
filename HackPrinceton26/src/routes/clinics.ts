/**
 * GET /api/clinics   — facility lookup with optional proximity filter
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../lib/auth';
import { supabase, haversineKm } from '../lib/supabase';

export const clinicsRouter = Router();

clinicsRouter.use(requireAuth);

// GET /api/clinics?lat=&lng=&radius_km=&noma_capable=true
clinicsRouter.get('/', async (req: Request, res: Response) => {
  const { lat, lng, radius_km, noma_capable } = req.query as Record<string, string>;

  let query = supabase().from('clinics').select('*');

  if (noma_capable === 'true') {
    query = query.eq('noma_capable', true);
  }

  const { data, error } = await query;

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  type ClinicRow = { id: string; name: string; region: string; lat: number; lng: number; noma_capable: boolean; contact: string };
  let results = (data ?? []) as ClinicRow[];

  // Post-filter by proximity if lat/lng/radius provided (Supabase free tier has no PostGIS)
  if (lat && lng && radius_km) {
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const radiusKm = parseFloat(radius_km);

    const withDist = results
      .map((c) => ({ ...c, distance_km: haversineKm(userLat, userLng, c.lat, c.lng) }))
      .filter((c) => c.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km);

    res.json({ data: withDist });
    return;
  }

  res.json({ data: results });
});
