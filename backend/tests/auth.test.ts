import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, secureCompare } from '../src/lib/auth';

describe('generateToken', () => {
  it('produces a URL-safe token with adequate entropy', () => {
    const token = generateToken();
    // 32 random bytes in base64url.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateToken));
    expect(tokens.size).toBe(500);
  });
});

describe('hashToken', () => {
  it('returns a SHA-256 hex digest', () => {
    expect(hashToken('demo')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashToken('chw-token-amina')).toBe(hashToken('chw-token-amina'));
  });

  it('never returns the plaintext', () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token);
  });

  it('matches the digest Postgres produces for the seeded tokens', () => {
    // Pinned so supabase/seed.sql — which computes
    // encode(digest(token, 'sha256'), 'hex') — stays in step with what the
    // server computes at sign-in. If these diverge, seeded CHWs cannot log in.
    expect(hashToken('chw-token-amina')).toBe(
      'c66965f27f866352614e0abd794cd851add5b937a5a2b5977bca80120a13900d',
    );
    expect(hashToken('demo')).toBe(
      '2a97516c354b68848cdbd8f54a226a0a55b21ed138e207ad6c5cbb9c00aa5aea',
    );
  });
});

describe('secureCompare', () => {
  it('accepts identical strings', () => {
    expect(secureCompare('correct-secret', 'correct-secret')).toBe(true);
  });

  it('rejects different strings of equal length', () => {
    expect(secureCompare('aaaaaaa', 'aaaaaab')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    // timingSafeEqual throws on a length mismatch; the wrapper must not.
    expect(() => secureCompare('short', 'much-longer-value')).not.toThrow();
    expect(secureCompare('short', 'much-longer-value')).toBe(false);
  });

  it('rejects the empty string against a real secret', () => {
    expect(secureCompare('', 'secret')).toBe(false);
  });
});
