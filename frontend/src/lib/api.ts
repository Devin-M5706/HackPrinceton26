const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001') as string;

function getToken(): string {
  return localStorage.getItem('chw_token') ?? '';
}

function authHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken()}`,
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TriageLevel = 'urgent' | 'refer' | 'monitor' | 'healthy';
export type Sex = 'male' | 'female' | 'unknown';

export interface ChildMeta {
  age_months: number;
  sex: Sex;
  symptoms?: string;
  nutrition_status?: string;
}

export interface ScreenRequest {
  image_b64: string;
  child_meta: ChildMeta;
  chw_id: string;
  lat?: number;
  lng?: number;
}

export interface ScreenResult {
  case_id: string | null;
  triage: TriageLevel;
  stage: number;
  risk_score: number;
  confidence: number;
  findings: string[];
  urgent: boolean;
  clinical_note: string;
  recommendation: string;
  risk_factors: string[];
  clinic: {
    id: string | null;
    name: string;
    distance_km: number;
    contact: string;
  };
  referral_note: string;
  mock: boolean;
}

export interface Case {
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
  child_age_months: number;
  created_at: string;
  chws?: { name: string; region: string };
  clinics?: { name: string; contact: string } | null;
}

export interface CasesResponse {
  data: Case[];
  meta: { page: number; limit: number; total: number };
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

export interface AlertsResponse {
  data: Alert[];
  meta: { days: number; count: number };
}

export interface Clinic {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  noma_capable: boolean;
  contact: string;
  distance_km?: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  mock_mode: boolean;
  supabase: { connected: boolean; configured: boolean };
  vm_pool: { ready: boolean; total: number; available: number; error: string | null };
  surveillance: { running: boolean; machineId: string | null; startedAt: string | null; error: string | null };
  notifications: { whatsapp_configured: boolean; imessage_configured: boolean; imessage_subscribers: number };
  last_alert_at: string | null;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * POST /api/screen
 * Runs the full 3-VM triage pipeline and returns a triage packet.
 * ~10s in live mode, instant in mock mode.
 */
export async function screen(payload: ScreenRequest): Promise<ScreenResult> {
  const res = await fetch(`${API_BASE}/api/screen`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse<ScreenResult>(res);
}

/**
 * GET /api/cases
 * Returns paginated cases for the authenticated CHW (or region-wide for supervisors).
 */
export async function getCases(params?: {
  page?: number;
  limit?: number;
  since?: string;
  region?: string;
}): Promise<CasesResponse> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.since) qs.set('since', params.since);
  if (params?.region) qs.set('region', params.region);
  const res = await fetch(`${API_BASE}/api/cases?${qs}`, {
    headers: authHeaders(),
  });
  return handleResponse<CasesResponse>(res);
}

/**
 * GET /api/cases/:id
 * Returns full detail for a single case.
 */
export async function getCase(id: string): Promise<Case> {
  const res = await fetch(`${API_BASE}/api/cases/${id}`, {
    headers: authHeaders(),
  });
  return handleResponse<Case>(res);
}

/**
 * GET /api/alerts
 * Returns outbreak alerts fired by VM 4 surveillance agent.
 */
export async function getAlerts(days = 30): Promise<AlertsResponse> {
  const res = await fetch(`${API_BASE}/api/alerts?days=${days}`, {
    headers: authHeaders(),
  });
  return handleResponse<AlertsResponse>(res);
}

/**
 * GET /api/clinics
 * Returns Noma-capable clinics, optionally filtered by proximity.
 */
export async function getClinics(params?: {
  lat?: number;
  lng?: number;
  radius_km?: number;
  noma_capable?: boolean;
}): Promise<{ data: Clinic[] }> {
  const qs = new URLSearchParams();
  if (params?.lat != null) qs.set('lat', String(params.lat));
  if (params?.lng != null) qs.set('lng', String(params.lng));
  if (params?.radius_km != null) qs.set('radius_km', String(params.radius_km));
  if (params?.noma_capable) qs.set('noma_capable', 'true');
  const res = await fetch(`${API_BASE}/api/clinics?${qs}`, {
    headers: authHeaders(),
  });
  return handleResponse<{ data: Clinic[] }>(res);
}

/**
 * GET /api/health
 * Returns system health — VM pool, Supabase, surveillance, notifications.
 * No auth required.
 */
export async function getHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/api/health`);
  return handleResponse<HealthStatus>(res);
}
