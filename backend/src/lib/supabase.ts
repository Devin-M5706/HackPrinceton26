import { createClient } from '@supabase/supabase-js';

// Service-role client — lazily initialised so the server can boot in mock mode
// without Supabase credentials. Call supabase() anywhere you'd use the client.
let _client: ReturnType<typeof createClient> | null = null;

export function supabase(): ReturnType<typeof createClient> {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type TriageLevel = 'urgent' | 'refer' | 'monitor' | 'healthy';
export type Language = 'hausa' | 'french' | 'english';

export interface Case {
  id: string;
  chw_id: string;
  stage: number;           // 1–5
  risk_score: number;      // 0–100
  triage: TriageLevel;
  clinical_note: string;
  referral_note: string;
  clinic_id: string | null;
  lat: number;
  lng: number;
  child_age_months: number;
  created_at: string;
}

export interface Chw {
  id: string;
  name: string;
  region: string;
  language: Language;
  auth_token: string;
  phone: string | null;
  created_at: string;
}

export interface Clinic {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  noma_capable: boolean;
  contact: string;
}

export interface Alert {
  id: string;
  region: string;
  case_count: number;
  radius_km: number;
  center_lat: number;
  center_lng: number;
  fired_at: string;
  notified: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Haversine distance in km between two lat/lng points. */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Map risk score → triage label. */
export function scoreToTriage(riskScore: number): TriageLevel {
  if (riskScore >= 75) return 'urgent';
  if (riskScore >= 50) return 'refer';
  if (riskScore >= 25) return 'monitor';
  return 'healthy';
}
