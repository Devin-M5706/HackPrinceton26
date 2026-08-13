/**
 * Request and model-output schemas.
 *
 * Two distinct trust boundaries are enforced here:
 *
 *   1. Client input — anything a CHW's browser sends. Rejected with 400.
 *   2. Model output — the JSON a language model claims to have produced.
 *      A model can return an out-of-range stage, a misspelled triage level, or
 *      prose where JSON was asked for. None of that may reach the database or
 *      a clinician's screen unchecked, so it is parsed with the same rigour as
 *      untrusted client input and falls back to a safe default when invalid.
 */

import { z } from 'zod';
import { config } from '../config';
import { badRequest } from './errors';

// ── Shared primitives ────────────────────────────────────────────────────────

export const TRIAGE_LEVELS = ['urgent', 'refer', 'monitor', 'healthy'] as const;
export type TriageLevel = (typeof TRIAGE_LEVELS)[number];

export const triageLevel = z.enum(TRIAGE_LEVELS);

/** WHO Noma stages run 1–5; 0 means "no disease identified". */
export const whoStage = z.number().int().min(0).max(5);

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/** Oldest patient the screening tool is intended for: 18 years. */
const ageMonths = z.number().int().min(0).max(216);

// ── Screening request ────────────────────────────────────────────────────────

export const childMetaSchema = z.object({
  age_months: ageMonths,
  sex: z.enum(['male', 'female', 'unknown']),
  symptoms: z.string().max(2000).optional(),
  nutrition_status: z.string().max(200).optional(),
});

export const screenRequestSchema = z.object({
  // Length is bounded here so a hostile payload is rejected before we spend
  // memory decoding it. 4/3 accounts for base64 expansion, plus padding slack.
  image_b64: z
    .string()
    .min(1, 'image_b64 must not be empty')
    .max(
      Math.ceil((config.MAX_IMAGE_BYTES * 4) / 3) + 1024,
      'image_b64 exceeds the maximum allowed size',
    ),
  child_meta: childMetaSchema,
  lat: latitude.optional(),
  lng: longitude.optional(),
});

export type ScreenRequest = z.infer<typeof screenRequestSchema>;
export type ChildMeta = z.infer<typeof childMetaSchema>;

// ── Image decoding ───────────────────────────────────────────────────────────

const IMAGE_SIGNATURES: ReadonlyArray<{
  mime: string;
  test: (b: Buffer) => boolean;
}> = [
  {
    mime: 'image/png',
    test: (b) =>
      b.length >= 8 &&
      b.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
  },
  {
    mime: 'image/jpeg',
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export interface DecodedImage {
  bytes: Buffer;
  mime: string;
}

/**
 * Decode a base64 image and verify it really is one of the formats we accept.
 *
 * `Buffer.from(s, 'base64')` never throws — it silently skips characters it
 * does not recognise — so the input is checked against the base64 alphabet
 * first, then the decoded bytes are matched against known file signatures.
 * Trusting a client-supplied MIME type would let a caller mislabel arbitrary
 * bytes as an image and pass them to the model provider.
 */
export function decodeImage(imageB64: string): DecodedImage {
  // Tolerate a data: URL prefix, which some browser paths include.
  const payload = imageB64.includes(',')
    ? imageB64.slice(imageB64.indexOf(',') + 1)
    : imageB64;

  const normalised = payload.replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalised) || normalised.length % 4 !== 0) {
    throw badRequest('image_b64 is not valid base64');
  }

  const bytes = Buffer.from(normalised, 'base64');

  if (bytes.length === 0) {
    throw badRequest('image_b64 decoded to zero bytes');
  }
  if (bytes.length > config.MAX_IMAGE_BYTES) {
    throw badRequest(
      `Image is larger than the ${Math.floor(config.MAX_IMAGE_BYTES / 1024 / 1024)}MB limit`,
    );
  }

  const match = IMAGE_SIGNATURES.find((sig) => sig.test(bytes));
  if (!match) {
    throw badRequest('Unsupported image format — use JPEG, PNG or WebP');
  }

  return { bytes, mime: match.mime };
}

// ── Model output ─────────────────────────────────────────────────────────────

export const visionResultSchema = z.object({
  stage: whoStage,
  risk_score: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  findings: z.array(z.string().max(500)).max(20).default([]),
  urgent: z.boolean(),
});

export const clinicalResultSchema = z.object({
  who_stage_confirmed: whoStage,
  clinical_note: z.string().min(1).max(5000),
  recommendation: z.string().min(1).max(2000),
  triage: triageLevel,
  risk_factors: z.array(z.string().max(200)).max(20).default([]),
});

export const referralNoteSchema = z.object({
  referral_note: z.string().min(1).max(5000),
});

export type VisionResult = z.infer<typeof visionResultSchema>;
export type ClinicalResult = z.infer<typeof clinicalResultSchema>;

/**
 * Extract and validate a JSON object from a model response.
 *
 * Models often wrap JSON in prose or a markdown fence despite instructions, so
 * the outermost brace pair is sliced out before parsing. Returns `null` rather
 * than throwing; every caller has a clinically safe fallback and a partially
 * parsed medical result is worse than none.
 */
export function parseModelJson<S extends z.ZodTypeAny>(
  raw: string | null | undefined,
  schema: S,
): z.infer<S> | null {
  if (!raw) return null;

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }

  const parsed = schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// ── Query parameters ─────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  since: z.string().datetime({ offset: true }).optional(),
  region: z.string().max(120).optional(),
});

export const alertsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export const clinicsQuerySchema = z
  .object({
    lat: z.coerce.number().pipe(latitude).optional(),
    lng: z.coerce.number().pipe(longitude).optional(),
    radius_km: z.coerce.number().positive().max(20_000).optional(),
    noma_capable: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .refine(
    (q) =>
      // Proximity filtering needs all three or none of them.
      [q.lat, q.lng, q.radius_km].every((v) => v === undefined) ||
      [q.lat, q.lng, q.radius_km].every((v) => v !== undefined),
    { message: 'lat, lng and radius_km must be supplied together' },
  );

export const alertPayloadSchema = z.object({
  region: z.string().min(1).max(120),
  case_count: z.number().int().min(1).max(100_000),
  radius_km: z.number().positive().max(1000),
  center_lat: latitude,
  center_lng: longitude,
});

export type AlertPayload = z.infer<typeof alertPayloadSchema>;

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Parse untrusted input, converting a schema failure into a 400 AppError.
 *
 * Generic over the schema rather than its output type so that `.default()`,
 * `.transform()` and `.refine()` all infer correctly — pinning `z.ZodType<T>`
 * conflates a schema's input and output types and re-widens defaulted fields
 * back to `| undefined`.
 */
export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  what: string,
): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const detail = result.error.issues
    .map((i) => `${i.path.join('.') || what}: ${i.message}`)
    .join('; ');
  throw badRequest(`Invalid ${what} — ${detail}`);
}
