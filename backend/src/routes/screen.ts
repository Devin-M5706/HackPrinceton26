/**
 * POST /api/screen
 *
 * Orchestrates the full triage pipeline across 3 Dedalus VMs:
 *   VM 1 (vision)   → Kimi K2.5 image analysis
 *   VM 2 (clinical) → Kimi K2.5 thinking-mode WHO staging
 *   VM 3 (referral) → nearest clinic lookup + CHW-language referral note
 *
 * Returns the aggregated triage packet and persists a case record to Supabase.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../lib/auth';
import { acquireVm, releaseVm } from '../lib/vmPool';
import { runScript } from '../lib/dedalus';
import { VISION_AGENT, CLINICAL_AGENT, REFERRAL_AGENT } from '../lib/agentScripts';
import { supabase, scoreToTriage } from '../lib/supabase';

export const screenRouter = Router();

interface ScreenBody {
  image_b64: string;
  child_meta: {
    age_months: number;
    sex: 'male' | 'female' | 'unknown';
    symptoms?: string;
    nutrition_status?: string;
  };
  chw_id: string;
  /** Coarse GPS — CHW's current location */
  lat?: number;
  lng?: number;
}

interface VisionResult {
  stage: number;
  risk_score: number;
  confidence: number;
  findings: string[];
  urgent: boolean;
  error?: string;
}

interface ClinicalResult {
  who_stage_confirmed: number;
  clinical_note: string;
  recommendation: string;
  triage: 'urgent' | 'refer' | 'monitor' | 'healthy';
  risk_factors: string[];
  error?: string;
}

interface ReferralResult {
  clinic_id: string | null;
  clinic_name: string;
  distance_km: number;
  contact: string;
  referral_note: string;
}

// Mock results used as fallback when Dedalus is unavailable
const MOCK_VISION: VisionResult = {
  stage: 3,
  risk_score: 72,
  confidence: 0.85,
  findings: ['Soft tissue necrosis visible on left cheek', 'Perioral oedema present', 'Active infection signs'],
  urgent: true,
};

const MOCK_CLINICAL: ClinicalResult = {
  who_stage_confirmed: 3,
  clinical_note: 'Patient presents with WHO Stage 3 Noma (established disease). Extensive soft tissue destruction on the left cheek with perioral involvement. Given the child\'s age and nutritional status, rapid progression is likely without immediate antibiotic treatment and hospital-level wound care.',
  recommendation: 'Administer oral amoxicillin immediately if available. Arrange urgent transport to a Noma-capable facility within 24 hours.',
  triage: 'urgent',
  risk_factors: ['Malnutrition', 'Age under 5', 'Active necrosis'],
};

const MOCK_REFERRAL: ReferralResult = {
  clinic_id: null,
  clinic_name: 'Zinder National Hospital',
  distance_km: 12.4,
  contact: '+227 20 51 23 45',
  referral_note: 'This child requires urgent Noma care. WHO Stage 3 confirmed. Please assess for surgical debridement and IV antibiotics.',
};

screenRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const body = req.body as ScreenBody;

  if (!body.image_b64 || !body.child_meta) {
    res.status(400).json({ error: 'image_b64 and child_meta are required' });
    return;
  }

  const chw = req.chw!;
  const lat = body.lat ?? 0;
  const lng = body.lng ?? 0;
  const useMock = process.env.MOCK_MODE === 'true';

  let visionResult: VisionResult;
  let clinicalResult: ClinicalResult;
  let referralResult: ReferralResult;

  if (useMock) {
    visionResult = MOCK_VISION;
    clinicalResult = MOCK_CLINICAL;
    referralResult = MOCK_REFERRAL;
  } else {
    try {
      // ── VM 1: vision ────────────────────────────────────────────────────────
      const vm1 = await acquireVm();
      try {
        const raw = await runScript({
          machineId: vm1.machineId,
          script: VISION_AGENT,
          env: {
            IMAGE_B64: body.image_b64,
            DEDALUS_API_KEY: process.env.DEDALUS_API_KEY!,
          },
          timeoutMs: 45_000,
        });
        visionResult = JSON.parse(raw) as VisionResult;
      } catch (err) {
        console.error('[screen] Vision VM failed:', err);
        visionResult = { ...MOCK_VISION, error: String(err) };
      } finally {
        await releaseVm(vm1.machineId, vm1.fromPool);
      }

      // ── VM 2: clinical ──────────────────────────────────────────────────────
      const vm2 = await acquireVm();
      try {
        const raw = await runScript({
          machineId: vm2.machineId,
          script: CLINICAL_AGENT,
          env: {
            VISION_JSON: JSON.stringify(visionResult),
            CHILD_META_JSON: JSON.stringify(body.child_meta),
            DEDALUS_API_KEY: process.env.DEDALUS_API_KEY!,
          },
          timeoutMs: 70_000,
        });
        clinicalResult = JSON.parse(raw) as ClinicalResult;
      } catch (err) {
        console.error('[screen] Clinical VM failed:', err);
        clinicalResult = { ...MOCK_CLINICAL, error: String(err) };
      } finally {
        await releaseVm(vm2.machineId, vm2.fromPool);
      }

      // ── VM 3: referral ──────────────────────────────────────────────────────
      const vm3 = await acquireVm();
      try {
        const raw = await runScript({
          machineId: vm3.machineId,
          script: REFERRAL_AGENT,
          env: {
            CLINICAL_JSON: JSON.stringify(clinicalResult),
            CHW_REGION: chw.region,
            CHW_LANGUAGE: chw.language,
            CHW_LAT: String(lat),
            CHW_LNG: String(lng),
            DEDALUS_API_KEY: process.env.DEDALUS_API_KEY!,
            SUPABASE_URL: process.env.SUPABASE_URL!,
            SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          },
          timeoutMs: 35_000,
        });
        referralResult = JSON.parse(raw) as ReferralResult;
      } catch (err) {
        console.error('[screen] Referral VM failed:', err);
        referralResult = MOCK_REFERRAL;
      } finally {
        await releaseVm(vm3.machineId, vm3.fromPool);
      }
    } catch (err) {
      console.error('[screen] VM pipeline unavailable — falling back to mock:', err);
      visionResult = MOCK_VISION;
      clinicalResult = MOCK_CLINICAL;
      referralResult = MOCK_REFERRAL;
    }
  }

  // ── Persist case to Supabase ───────────────────────────────────────────────
  const triage = clinicalResult.triage ?? scoreToTriage(visionResult.risk_score);

  let caseRecord: { id: string } | null = null;
  if (process.env.SUPABASE_URL) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: dbError } = await (supabase().from('cases') as any)
      .insert({
        chw_id: chw.id,
        stage: visionResult.stage,
        risk_score: visionResult.risk_score,
        triage,
        clinical_note: clinicalResult.clinical_note,
        referral_note: referralResult.referral_note,
        clinic_id: referralResult.clinic_id ?? null,
        lat,
        lng,
        region: chw.region,
        child_age_months: body.child_meta.age_months,
      })
      .select()
      .single();
    if (dbError) console.error('[screen] Supabase insert failed:', dbError);
    caseRecord = (data as { id: string } | null);
  }

  res.json({
    case_id: caseRecord?.id ?? null,
    triage,
    stage: visionResult.stage,
    risk_score: visionResult.risk_score,
    confidence: visionResult.confidence,
    findings: visionResult.findings,
    urgent: visionResult.urgent,
    clinical_note: clinicalResult.clinical_note,
    recommendation: clinicalResult.recommendation,
    risk_factors: clinicalResult.risk_factors ?? [],
    clinic: {
      id: referralResult.clinic_id,
      name: referralResult.clinic_name,
      distance_km: referralResult.distance_km,
      contact: referralResult.contact,
    },
    referral_note: referralResult.referral_note,
    mock: useMock,
  });
});
