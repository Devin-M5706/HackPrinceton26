/**
 * The three-stage Noma triage pipeline.
 *
 *   1. Vision    — WHO stage and risk score from the photograph.
 *   2. Clinical  — staging confirmation and a recommendation, given the child's
 *                  age, symptoms and nutritional status.
 *   3. Referral  — nearest Noma-capable facility plus a note in the CHW's language.
 *
 * Safety contract for failures
 * ----------------------------
 * When a stage fails, this module does NOT substitute plausible-looking
 * clinical findings. An earlier revision fell back to a canned "Stage 3,
 * necrosis on the left cheek" result whenever the model call errored, which
 * presented a fabricated diagnosis as a real one. Instead a failed stage yields
 * an explicitly empty result, the packet is flagged `degraded`, and triage
 * defaults to `refer` — send the child to a clinician, because the tool could
 * not assess them.
 */

import Dedalus from 'dedalus-labs';
import { config } from '../config';
import { createLogger, describeError } from './logger';
import {
  clinicalResultSchema,
  parseModelJson,
  referralNoteSchema,
  visionResultSchema,
  type ChildMeta,
  type ClinicalResult,
  type DecodedImage,
  type TriageLevel,
  type VisionResult,
} from './validation';
import { haversineKm, supabase, type Chw, type Clinic } from './supabase';

const log = createLogger('triage');

const MODEL_TIMEOUT_MS = 45_000;
const MODEL_MAX_RETRIES = 2;

let cachedClient: Dedalus | null = null;

function client(): Dedalus {
  if (!cachedClient) {
    if (!config.DEDALUS_API_KEY) {
      throw new Error('DEDALUS_API_KEY is not configured');
    }
    cachedClient = new Dedalus({
      apiKey: config.DEDALUS_API_KEY,
      timeout: MODEL_TIMEOUT_MS,
      maxRetries: MODEL_MAX_RETRIES,
    });
  }
  return cachedClient;
}

/** Reset the memoised inference client. Test-only. */
export function resetTriageClient(): void {
  cachedClient = null;
}

// ── Result shapes ────────────────────────────────────────────────────────────

export interface ReferralResult {
  clinic_id: string | null;
  clinic_name: string;
  distance_km: number;
  contact: string;
  referral_note: string;
}

export interface TriagePacket {
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
  /** True when the result came from canned demo data rather than a model. */
  mock: boolean;
  /** True when one or more stages failed and the result is not a real assessment. */
  degraded: boolean;
  /** Which stages failed, for the client to surface honestly. */
  degraded_stages: string[];
}

export interface TriageInput {
  image: DecodedImage;
  imageB64: string;
  childMeta: ChildMeta;
  chw: Chw;
  lat: number;
  lng: number;
}

// ── Fallbacks ────────────────────────────────────────────────────────────────

/**
 * What we return when the vision model could not assess the image.
 * Deliberately empty — no stage, no score, no findings.
 */
const UNASSESSED_VISION: VisionResult = Object.freeze({
  stage: 0,
  risk_score: 0,
  confidence: 0,
  findings: [],
  urgent: false,
});

const UNASSESSED_CLINICAL: ClinicalResult = Object.freeze({
  who_stage_confirmed: 0,
  clinical_note:
    'Automated assessment was unavailable for this screening. No AI analysis of ' +
    'this image has been performed and no clinical conclusion should be drawn ' +
    'from this record.',
  recommendation:
    'Refer the child for in-person assessment by a trained health worker. Do not ' +
    'rely on this app to rule out Noma.',
  triage: 'refer',
  risk_factors: [],
});

const FALLBACK_REFERRAL_NOTE =
  'Please assess this child for Noma (cancrum oris). Automated screening was ' +
  'unavailable, so this referral is precautionary.';

// ── Demo data ────────────────────────────────────────────────────────────────

const DEMO_PACKET: Omit<TriagePacket, 'mock' | 'degraded' | 'degraded_stages'> =
  Object.freeze({
    triage: 'urgent',
    stage: 3,
    risk_score: 72,
    confidence: 0.85,
    findings: [
      'Soft tissue necrosis visible on left cheek',
      'Perioral oedema present',
      'Active infection signs',
    ],
    urgent: true,
    clinical_note:
      'Demonstration result. Patient presents with WHO Stage 3 Noma (established ' +
      'disease). Extensive soft tissue destruction on the left cheek with perioral ' +
      'involvement.',
    recommendation:
      'Demonstration result. Administer oral amoxicillin immediately if available ' +
      'and arrange urgent transport to a Noma-capable facility within 24 hours.',
    risk_factors: ['Malnutrition', 'Age under 5', 'Active necrosis'],
    clinic: {
      id: null,
      name: 'Zinder National Hospital',
      distance_km: 12.4,
      contact: '+227 20 51 23 45',
    },
    referral_note:
      'Demonstration result. This child requires urgent Noma care. WHO Stage 3 ' +
      'confirmed. Please assess for surgical debridement and IV antibiotics.',
  });

// ── Stages ───────────────────────────────────────────────────────────────────

const VISION_PROMPT = `You are an expert clinician trained in WHO Noma (cancrum oris) staging. Examine the wound in this image and return ONLY a valid JSON object — no markdown, no prose.

Fields required:
- stage: integer 0-5 (WHO Noma stage; 0=no disease identified, 1=prodromal, 5=healed/sequela)
- risk_score: integer 0-100
- confidence: float 0.0-1.0
- findings: array of short strings describing key visual observations
- urgent: boolean (true if immediate hospital referral is needed)`;

const CLINICAL_SYSTEM_PROMPT =
  'You are a WHO-trained Noma specialist providing clinical decision support for ' +
  'community health workers in sub-Saharan Africa. Always err on the side of caution.';

async function runVisionStage(input: TriageInput): Promise<VisionResult | null> {
  const response = await client().chat.completions.create({
    model: config.DEDALUS_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${input.image.mime};base64,${input.imageB64}` },
          },
          { type: 'text', text: VISION_PROMPT },
        ],
      },
    ],
  });

  return parseModelJson(response.choices[0]?.message?.content, visionResultSchema);
}

async function runClinicalStage(
  input: TriageInput,
  vision: VisionResult,
): Promise<ClinicalResult | null> {
  const { childMeta } = input;

  const userPrompt = [
    `Vision result: ${JSON.stringify(vision)}`,
    `Child: age ${childMeta.age_months} months, ${childMeta.sex}`,
    `Symptoms: ${childMeta.symptoms ?? 'none recorded'}`,
    `Nutritional status: ${childMeta.nutrition_status ?? 'unknown'}`,
    '',
    'Return ONLY valid JSON with: who_stage_confirmed (integer 0-5), ' +
      'clinical_note (string), recommendation (string), ' +
      'triage ("urgent"|"refer"|"monitor"|"healthy"), risk_factors (string[]).',
  ].join('\n');

  const response = await client().chat.completions.create({
    model: config.DEDALUS_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: CLINICAL_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  return parseModelJson(response.choices[0]?.message?.content, clinicalResultSchema);
}

/** Nearest Noma-capable clinic to the CHW, or null if none are on record. */
async function findNearestClinic(
  lat: number,
  lng: number,
): Promise<{ clinic: Clinic; distanceKm: number } | null> {
  const { data, error } = await supabase()
    .from('clinics')
    .select('*')
    .eq('noma_capable', true);

  if (error) {
    log.warn('Clinic lookup failed', { code: error.code });
    return null;
  }

  let best: { clinic: Clinic; distanceKm: number } | null = null;
  for (const clinic of data ?? []) {
    const distanceKm = haversineKm(lat, lng, clinic.lat, clinic.lng);
    if (!best || distanceKm < best.distanceKm) {
      best = { clinic, distanceKm };
    }
  }
  return best;
}

async function runReferralStage(
  input: TriageInput,
  clinical: ClinicalResult,
): Promise<ReferralResult> {
  const nearest = config.supabaseConfigured
    ? await findNearestClinic(input.lat, input.lng)
    : null;

  const facilityName = nearest?.clinic.name ?? 'the nearest health centre';

  let referralNote = FALLBACK_REFERRAL_NOTE;
  try {
    const response = await client().chat.completions.create({
      model: config.DEDALUS_MODEL,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content:
            `Write a brief referral note in ${input.chw.language} for a community ` +
            `health worker to hand to a clinic.\n` +
            `Clinical context: ${JSON.stringify(clinical)}\n` +
            `Facility: ${facilityName}\n` +
            `Return ONLY JSON: { "referral_note": "..." }`,
        },
      ],
    });

    const parsed = parseModelJson(
      response.choices[0]?.message?.content,
      referralNoteSchema,
    );
    if (parsed) referralNote = parsed.referral_note;
    else log.warn('Referral note failed validation; using fallback text');
  } catch (err) {
    log.warn('Referral note generation failed', describeError(err));
  }

  return {
    clinic_id: nearest?.clinic.id ?? null,
    clinic_name: nearest?.clinic.name ?? 'Nearest Health Centre',
    distance_km: nearest ? Math.round(nearest.distanceKm * 10) / 10 : 0,
    contact: nearest?.clinic.contact ?? '',
    referral_note: referralNote,
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Run the full pipeline.
 *
 * Never rejects on a model or database failure: a CHW standing in front of a
 * sick child gets a conservative "refer" result flagged as degraded, rather
 * than an error screen.
 */
export async function runTriagePipeline(input: TriageInput): Promise<TriagePacket> {
  if (config.MOCK_MODE) {
    return { ...DEMO_PACKET, mock: true, degraded: false, degraded_stages: [] };
  }

  const degradedStages: string[] = [];

  // ── Stage 1: vision ────────────────────────────────────────────────────────
  let vision: VisionResult;
  try {
    const result = await runVisionStage(input);
    if (result) {
      vision = result;
      log.info('Vision stage complete', {
        stage: result.stage,
        risk_score: result.risk_score,
      });
    } else {
      vision = UNASSESSED_VISION;
      degradedStages.push('vision');
      log.warn('Vision stage returned unusable output');
    }
  } catch (err) {
    vision = UNASSESSED_VISION;
    degradedStages.push('vision');
    log.error('Vision stage failed', describeError(err));
  }

  // ── Stage 2: clinical reasoning ────────────────────────────────────────────
  // Skipped when vision failed: reasoning over an empty assessment would only
  // invite the model to invent findings.
  let clinical: ClinicalResult;
  if (degradedStages.includes('vision')) {
    clinical = UNASSESSED_CLINICAL;
    degradedStages.push('clinical');
  } else {
    try {
      const result = await runClinicalStage(input, vision);
      if (result) {
        clinical = result;
        log.info('Clinical stage complete', { triage: result.triage });
      } else {
        clinical = UNASSESSED_CLINICAL;
        degradedStages.push('clinical');
        log.warn('Clinical stage returned unusable output');
      }
    } catch (err) {
      clinical = UNASSESSED_CLINICAL;
      degradedStages.push('clinical');
      log.error('Clinical stage failed', describeError(err));
    }
  }

  // ── Stage 3: referral ──────────────────────────────────────────────────────
  let referral: ReferralResult;
  try {
    referral = await runReferralStage(input, clinical);
    log.info('Referral stage complete', {
      distance_km: referral.distance_km,
      matched_clinic: referral.clinic_id !== null,
    });
  } catch (err) {
    degradedStages.push('referral');
    log.error('Referral stage failed', describeError(err));
    referral = {
      clinic_id: null,
      clinic_name: 'Nearest Health Centre',
      distance_km: 0,
      contact: '',
      referral_note: FALLBACK_REFERRAL_NOTE,
    };
  }

  return {
    triage: clinical.triage,
    stage: vision.stage,
    risk_score: vision.risk_score,
    confidence: vision.confidence,
    findings: vision.findings,
    urgent: vision.urgent,
    clinical_note: clinical.clinical_note,
    recommendation: clinical.recommendation,
    risk_factors: clinical.risk_factors,
    clinic: {
      id: referral.clinic_id,
      name: referral.clinic_name,
      distance_km: referral.distance_km,
      contact: referral.contact,
    },
    referral_note: referral.referral_note,
    mock: false,
    degraded: degradedStages.length > 0,
    degraded_stages: degradedStages,
  };
}
