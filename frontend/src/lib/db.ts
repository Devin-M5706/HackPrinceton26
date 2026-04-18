import Dexie, { type Table } from 'dexie'
import type { ScreenResult, ChildMeta, TriageLevel } from './api'

// ── Schema ────────────────────────────────────────────────────────────────────

export interface LocalCase {
  id: string              // case_id from API, or `local-{timestamp}` when offline
  triage: TriageLevel
  stage: number
  risk_score: number
  confidence: number
  findings: string[]
  clinical_note: string
  recommendation: string
  risk_factors: string[]
  referral_note: string
  clinic_name: string
  clinic_contact: string
  clinic_distance_km: number
  child_age_months: number
  child_sex: string
  child_symptoms: string
  image_b64?: string      // stored locally for offline reference / re-display
  synced: boolean         // true = saved to Supabase via backend
  mock: boolean           // true = came from mock pipeline
  created_at: string
}

// ── Database ──────────────────────────────────────────────────────────────────

class NomaAlertDB extends Dexie {
  cases!: Table<LocalCase, string>

  constructor() {
    super('nomaalert-v1')
    this.version(1).stores({
      // indexed fields: id (PK), triage, stage, synced, created_at
      cases: 'id, triage, stage, synced, created_at',
    })
  }
}

export const db = new NomaAlertDB()

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Persist a completed screening result to IndexedDB.
 * Called immediately after a successful /api/screen response.
 */
export async function saveCase(
  result: ScreenResult,
  meta: ChildMeta,
  imageB64?: string,
): Promise<void> {
  const record: LocalCase = {
    id: result.case_id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    triage: result.triage,
    stage: result.stage,
    risk_score: result.risk_score,
    confidence: result.confidence,
    findings: result.findings,
    clinical_note: result.clinical_note,
    recommendation: result.recommendation,
    risk_factors: result.risk_factors,
    referral_note: result.referral_note,
    clinic_name: result.clinic.name,
    clinic_contact: result.clinic.contact,
    clinic_distance_km: result.clinic.distance_km,
    child_age_months: meta.age_months,
    child_sex: meta.sex,
    child_symptoms: meta.symptoms ?? '',
    image_b64: imageB64,
    synced: !!result.case_id, // has a server-assigned UUID → synced
    mock: result.mock,
    created_at: new Date().toISOString(),
  }
  await db.cases.put(record)
}

/** All cases, newest first. */
export async function getAllCases(): Promise<LocalCase[]> {
  return db.cases.orderBy('created_at').reverse().toArray()
}

/** Cases that failed to reach the server and need retry. */
export async function getPendingCases(): Promise<LocalCase[]> {
  return db.cases.where('synced').equals(0).toArray()
}

/** Single case by ID. */
export async function getCaseById(id: string): Promise<LocalCase | undefined> {
  return db.cases.get(id)
}

/** Mark a locally-created case as synced after a successful retry. */
export async function markSynced(localId: string, serverId: string): Promise<void> {
  await db.cases.where('id').equals(localId).modify({ id: serverId, synced: true })
}

/** Total number of cases stored locally. */
export async function caseCount(): Promise<number> {
  return db.cases.count()
}
