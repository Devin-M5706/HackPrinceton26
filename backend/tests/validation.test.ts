import { describe, expect, it } from 'vitest';
import {
  clinicalResultSchema,
  decodeImage,
  parseModelJson,
  parseOrThrow,
  screenRequestSchema,
  visionResultSchema,
} from '../src/lib/validation';
import { AppError } from '../src/lib/errors';

// Smallest valid files of each type, for signature checking.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]).toString('base64');

describe('decodeImage', () => {
  it('accepts PNG, JPEG and WebP', () => {
    expect(decodeImage(PNG_1X1).mime).toBe('image/png');
    expect(decodeImage(JPEG_HEADER).mime).toBe('image/jpeg');
    expect(decodeImage(WEBP_HEADER).mime).toBe('image/webp');
  });

  it('strips a data: URL prefix', () => {
    expect(decodeImage(`data:image/png;base64,${PNG_1X1}`).mime).toBe('image/png');
  });

  it('rejects input that is not base64', () => {
    // Buffer.from(s, 'base64') silently drops unknown characters instead of
    // throwing, so the alphabet has to be checked explicitly.
    expect(() => decodeImage('!!! not base64 !!!')).toThrow(AppError);
  });

  it('rejects non-image bytes that decode cleanly', () => {
    const textAsBase64 = Buffer.from('this is not an image').toString('base64');
    expect(() => decodeImage(textAsBase64)).toThrow(/Unsupported image format/);
  });

  it('rejects an empty payload', () => {
    expect(() => decodeImage('')).toThrow(AppError);
  });

  it('rejects an image over the size limit', () => {
    // Valid PNG signature followed by padding past MAX_IMAGE_BYTES (8 MiB).
    const huge = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(9 * 1024 * 1024),
    ]).toString('base64');
    expect(() => decodeImage(huge)).toThrow(/larger than/);
  });
});

describe('screenRequestSchema', () => {
  const valid = {
    image_b64: PNG_1X1,
    child_meta: { age_months: 48, sex: 'male' as const },
  };

  it('accepts a well-formed request', () => {
    expect(() => parseOrThrow(screenRequestSchema, valid, 'request')).not.toThrow();
  });

  it('rejects an implausible age', () => {
    expect(() =>
      parseOrThrow(
        screenRequestSchema,
        { ...valid, child_meta: { ...valid.child_meta, age_months: 5000 } },
        'request',
      ),
    ).toThrow(AppError);
  });

  it('rejects out-of-range coordinates', () => {
    expect(() =>
      parseOrThrow(screenRequestSchema, { ...valid, lat: 91, lng: 0 }, 'request'),
    ).toThrow(AppError);
  });

  it('ignores a client-supplied chw_id', () => {
    // Attribution comes from the bearer token; accepting this field would let
    // one CHW file cases against another.
    const parsed = parseOrThrow(
      screenRequestSchema,
      { ...valid, chw_id: 'someone-else' },
      'request',
    );
    expect(parsed).not.toHaveProperty('chw_id');
  });
});

describe('parseModelJson', () => {
  it('extracts JSON wrapped in prose or a markdown fence', () => {
    const wrapped =
      'Here is the assessment:\n```json\n' +
      '{"stage":3,"risk_score":72,"confidence":0.85,"findings":["a"],"urgent":true}' +
      '\n```\nHope that helps.';
    expect(parseModelJson(wrapped, visionResultSchema)?.stage).toBe(3);
  });

  it('returns null for a stage outside the WHO range', () => {
    const out = parseModelJson(
      '{"stage":99,"risk_score":50,"confidence":0.5,"findings":[],"urgent":false}',
      visionResultSchema,
    );
    expect(out).toBeNull();
  });

  it('returns null for a risk score outside 0-100', () => {
    const out = parseModelJson(
      '{"stage":2,"risk_score":5000,"confidence":0.5,"findings":[],"urgent":false}',
      visionResultSchema,
    );
    expect(out).toBeNull();
  });

  it('returns null for an unrecognised triage level', () => {
    const out = parseModelJson(
      '{"who_stage_confirmed":3,"clinical_note":"n","recommendation":"r",' +
        '"triage":"very urgent","risk_factors":[]}',
      clinicalResultSchema,
    );
    expect(out).toBeNull();
  });

  it('returns null for prose with no JSON at all', () => {
    expect(parseModelJson('I cannot assess this image.', visionResultSchema)).toBeNull();
  });

  it('returns null for empty or missing input', () => {
    expect(parseModelJson('', visionResultSchema)).toBeNull();
    expect(parseModelJson(null, visionResultSchema)).toBeNull();
    expect(parseModelJson(undefined, visionResultSchema)).toBeNull();
  });

  it('defaults absent optional arrays rather than failing', () => {
    const out = parseModelJson(
      '{"stage":1,"risk_score":10,"confidence":0.4,"urgent":false}',
      visionResultSchema,
    );
    expect(out?.findings).toEqual([]);
  });
});
