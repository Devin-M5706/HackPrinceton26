/**
 * Supabase service-role client and the database row types.
 *
 * The client is created lazily so the server can boot in mock mode without
 * credentials. It uses the service-role key, which bypasses row-level
 * security — every access-control decision therefore has to be made in
 * application code, and `assertCanReadCase` in routes/cases.ts is where that
 * happens for patient records.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { serviceUnavailable } from './errors';
import type { TriageLevel } from './validation';

export type { TriageLevel };

export type Language = 'hausa' | 'french' | 'english';
export type ChwRole = 'chw' | 'supervisor';

// ── Row types ────────────────────────────────────────────────────────────────
//
// Declared as type aliases rather than interfaces on purpose. supabase-js
// constrains each table's Row to `Record<string, unknown>`, and TypeScript only
// gives *type aliases* an implicit index signature — an interface fails that
// constraint, the whole Database generic silently degrades to `never`, and
// every query result becomes untyped.

export type Chw = {
  id: string;
  name: string;
  region: string;
  language: Language;
  /** SHA-256 hex digest of the bearer token. The token itself is never stored. */
  auth_token_hash: string;
  role: ChwRole;
  phone: string | null;
  created_at: string;
};

export type Case = {
  id: string;
  chw_id: string;
  stage: number;
  risk_score: number;
  triage: TriageLevel;
  clinical_note: string;
  referral_note: string;
  clinic_id: string | null;
  lat: number;
  lng: number;
  region: string;
  child_age_months: number;
  created_at: string;
};

export type Clinic = {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  noma_capable: boolean;
  contact: string;
};

export type Alert = {
  id: string;
  region: string;
  case_count: number;
  radius_km: number;
  center_lat: number;
  center_lng: number;
  fired_at: string;
  notified: boolean;
};

/**
 * Schema shape for the supabase-js generic parameter.
 *
 * Without it every `.insert()` argument collapses to `never` and the only way
 * to compile is an `as any` cast, which discards column-name checking entirely.
 */
export type Database = {
  public: {
    Tables: {
      chws: {
        Row: Chw;
        Insert: Omit<Chw, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Chw>;
        Relationships: [];
      };
      cases: {
        Row: Case;
        Insert: Omit<Case, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Case>;
        // Declared so embedded selects such as `clinics(name, contact)` type
        // check. Without them PostgREST-style joins resolve to a query error
        // and the whole row collapses to `never`.
        Relationships: [
          {
            foreignKeyName: 'cases_clinic_id_fkey';
            columns: ['clinic_id'];
            isOneToOne: false;
            referencedRelation: 'clinics';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cases_chw_id_fkey';
            columns: ['chw_id'];
            isOneToOne: false;
            referencedRelation: 'chws';
            referencedColumns: ['id'];
          },
        ];
      };
      clinics: {
        Row: Clinic;
        Insert: Omit<Clinic, 'id'> & { id?: string };
        Update: Partial<Clinic>;
        Relationships: [];
      };
      alerts: {
        Row: Alert;
        Insert: Omit<Alert, 'id' | 'fired_at'> & { id?: string; fired_at?: string };
        Update: Partial<Alert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Db = SupabaseClient<Database>;

// ── Client ───────────────────────────────────────────────────────────────────

let client: Db | null = null;

/**
 * Get the service-role client.
 *
 * Throws a 503 rather than a bare Error when credentials are absent, so a
 * misconfigured deployment returns a clean "database not configured" response
 * instead of a 500 with a stack trace.
 */
export function supabase(): Db {
  if (client) return client;

  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw serviceUnavailable('Database is not configured');
  }

  client = createClient<Database>(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client;
}

/** Reset the memoised client. Test-only. */
export function resetSupabaseClient(): void {
  client = null;
}

// ── Geo helpers ──────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two WGS-84 points. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Round a coordinate to a coarse grid before exposing it publicly.
 *
 * Two decimal places is roughly 1.1 km at the equator — enough to show an
 * outbreak cluster on a map, not enough to identify the household a sick child
 * lives in. Used by the unauthenticated map endpoint.
 */
export function coarsenCoordinate(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Map a 0–100 risk score onto a triage level. */
export function scoreToTriage(riskScore: number): TriageLevel {
  if (riskScore >= 75) return 'urgent';
  if (riskScore >= 50) return 'refer';
  if (riskScore >= 25) return 'monitor';
  return 'healthy';
}
