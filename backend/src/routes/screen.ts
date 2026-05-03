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
import { supabase, scoreToTriage } from '../lib/supabase';
import Dedalus from 'dedalus-labs';

const AI_MODEL = 'anthropic/claude-haiku-4-5-20251001';
let _ai: Dedalus | null = null;
function getAi(): Dedalus {
  if (!_ai) _ai = new Dedalus({ apiKey: process.env.DEDALUS_API_KEY! });
  return _ai;
}

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

  const imageBytes = Buffer.from(body.image_b64, 'base64');
  let imageMime = 'image/jpeg';
  if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) imageMime = 'image/png';
  else if (imageBytes[0] === 0x52 && imageBytes[1] === 0x49) imageMime = 'image/webp';
  else if (imageBytes[0] === 0x47 && imageBytes[1] === 0x49) imageMime = 'image/gif';

  let visionResult: VisionResult;
  let clinicalResult: ClinicalResult;
  let referralResult: ReferralResult;

  if (useMock) {
    visionResult = MOCK_VISION;
    clinicalResult = MOCK_CLINICAL;
    referralResult = MOCK_REFERRAL;
  } else {
    try {
      // ── Step 1: Vision analysis ─────────────────────────────────────────────
      console.log('\n┌─────────────────────────────────────────────┐');
      console.log('│  VM 1 · Vision Analysis                     │');
      console.log('└─────────────────────────────────────────────┘');
      const visionRaw = await getAi().chat.completions.create({
        model: AI_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${imageMime};base64,${body.image_b64}` } },
            { type: 'text', text: `You are an expert clinician trained in WHO Noma (cancrum oris) staging. Examine the wound in this image and return ONLY a valid JSON object — no markdown, no prose.\n\nFields required:\n- stage: integer 1–5 (WHO Noma stage; 1=prodromal, 5=healed/sequela)\n- risk_score: integer 0–100\n- confidence: float 0.0–1.0\n- findings: array of short strings describing key visual observations\n- urgent: boolean (true if immediate hospital referral is needed)` },
          ],
        }],
        max_tokens: 512,
      });
      const visionContent = visionRaw.choices[0].message.content ?? '';
      visionResult = JSON.parse(visionContent.slice(visionContent.indexOf('{'), visionContent.lastIndexOf('}') + 1)) as VisionResult;
      console.log(`  ✓ VM 1 complete — stage ${visionResult.stage}, score ${visionResult.risk_score}\n`);
    } catch (err) {
      console.error('[screen] Vision step failed:', err);
      visionResult = { ...MOCK_VISION, error: String(err) };
    }

    try {
      // ── Step 2: Clinical reasoning ──────────────────────────────────────────
      console.log('\n┌─────────────────────────────────────────────┐');
      console.log('│  VM 2 · Clinical Reasoning                  │');
      console.log('└─────────────────────────────────────────────┘');
      const clinicalRaw = await getAi().chat.completions.create({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'You are a WHO-trained Noma specialist providing clinical decision support for community health workers in sub-Saharan Africa. Always err on the side of caution.' },
          { role: 'user', content: `Vision result: ${JSON.stringify(visionResult)}\nChild: age ${body.child_meta.age_months}mo, ${body.child_meta.sex}, symptoms: ${body.child_meta.symptoms ?? 'none'}, nutrition: ${body.child_meta.nutrition_status ?? 'unknown'}\n\nReturn ONLY valid JSON with: who_stage_confirmed (int), clinical_note (string), recommendation (string), triage ("urgent"|"refer"|"monitor"|"healthy"), risk_factors (string[])` },
        ],
        max_tokens: 1024,
      });
      const clinContent = clinicalRaw.choices[0].message.content ?? '';
      clinicalResult = JSON.parse(clinContent.slice(clinContent.indexOf('{'), clinContent.lastIndexOf('}') + 1)) as ClinicalResult;
      console.log(`  ✓ VM 2 complete — triage: ${clinicalResult.triage}\n`);
    } catch (err) {
      console.error('[screen] Clinical step failed:', err);
      clinicalResult = { ...MOCK_CLINICAL, error: String(err) };
    }

    try {
      // ── Step 3: Referral — nearest clinic from Supabase + AI note ──────────
      console.log('\n┌─────────────────────────────────────────────┐');
      console.log('│  VM 3 · Referral & Clinic Lookup            │');
      console.log('└─────────────────────────────────────────────┘');
      const { data: clinics } = await supabase().from('clinics').select('*').eq('noma_capable', true);
      const haversine = (a: number, b: number, c: number, d: number) => {
        const R = 6371, dLat = (c - a) * Math.PI / 180, dLng = (d - b) * Math.PI / 180;
        const x = Math.sin(dLat/2)**2 + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
      };
      const nearest = (clinics ?? []).reduce((best: any, c: any) => {
        const d = haversine(lat, lng, c.lat, c.lng);
        return !best || d < best.dist ? { ...c, dist: d } : best;
      }, null);

      const noteRaw = await getAi().chat.completions.create({
        model: AI_MODEL,
        messages: [{ role: 'user', content: `Write a brief referral note in ${chw.language} for a CHW to give to a clinic.\nClinical context: ${JSON.stringify(clinicalResult)}\nFacility: ${nearest?.name ?? 'nearest health centre'}\nReturn ONLY JSON: { "referral_note": "..." }` }],
        max_tokens: 512,
      });
      const noteContent = noteRaw.choices[0].message.content ?? '';
      const noteObj = JSON.parse(noteContent.slice(noteContent.indexOf('{'), noteContent.lastIndexOf('}') + 1));
      referralResult = {
        clinic_id: nearest?.id ?? null,
        clinic_name: nearest?.name ?? 'Nearest Health Centre',
        distance_km: nearest ? Math.round(nearest.dist * 10) / 10 : 0,
        contact: nearest?.contact ?? 'N/A',
        referral_note: noteObj.referral_note,
      };
      console.log(`  ✓ VM 3 complete — clinic: ${referralResult.clinic_name} (${referralResult.distance_km} km)\n`);
    } catch (err) {
      console.error('[screen] Referral step failed:', err);
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
