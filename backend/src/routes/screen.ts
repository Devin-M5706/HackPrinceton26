/**
 * POST /api/screen — run the triage pipeline on one photograph.
 *
 * The case is attributed to the authenticated CHW. A `chw_id` in the request
 * body is ignored on purpose: accepting it would let any token file cases
 * against another health worker.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../lib/auth';
import { asyncHandler } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { runTriagePipeline } from '../lib/triage';
import { supabase } from '../lib/supabase';
import { config } from '../config';
import { decodeImage, parseOrThrow, screenRequestSchema } from '../lib/validation';

const log = createLogger('screen');

export const screenRouter = Router();

screenRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = parseOrThrow(screenRequestSchema, req.body, 'screening request');
    const chw = req.chw!;

    // Verifies the payload really is a JPEG/PNG/WebP within the size limit
    // before it is forwarded to the model provider.
    const image = decodeImage(body.image_b64);

    const lat = body.lat ?? 0;
    const lng = body.lng ?? 0;

    const startedAt = Date.now();
    const packet = await runTriagePipeline({
      image,
      imageB64: body.image_b64,
      childMeta: body.child_meta,
      chw,
      lat,
      lng,
    });

    log.info('Screening complete', {
      chw_id: chw.id,
      triage: packet.triage,
      stage: packet.stage,
      degraded: packet.degraded,
      duration_ms: Date.now() - startedAt,
    });

    // ── Persist ──────────────────────────────────────────────────────────────
    // A storage failure must not lose the CHW's result, so it is logged and the
    // packet is still returned with case_id null. The client keeps it locally.
    let caseId: string | null = null;

    if (config.supabaseConfigured && !packet.mock) {
      const { data, error } = await supabase()
        .from('cases')
        .insert({
          chw_id: chw.id,
          stage: packet.stage,
          risk_score: packet.risk_score,
          triage: packet.triage,
          clinical_note: packet.clinical_note,
          referral_note: packet.referral_note,
          clinic_id: packet.clinic.id,
          lat,
          lng,
          region: chw.region,
          child_age_months: body.child_meta.age_months,
        })
        .select('id')
        .single();

      if (error) {
        log.error('Case insert failed', { code: error.code, chw_id: chw.id });
      } else {
        caseId = data.id;
      }
    }

    res.json({
      case_id: caseId,
      persisted: caseId !== null,
      ...packet,
    });
  }),
);
