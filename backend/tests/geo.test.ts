import { describe, expect, it } from 'vitest';
import { coarsenCoordinate, haversineKm, scoreToTriage } from '../src/lib/supabase';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(13.8, 8.99, 13.8, 8.99)).toBe(0);
  });

  it('matches a known distance', () => {
    // Zinder to Maradi, Niger — roughly 205 km.
    const km = haversineKm(13.8069, 8.9881, 13.5006, 7.0977);
    expect(km).toBeGreaterThan(195);
    expect(km).toBeLessThan(215);
  });

  it('is symmetric', () => {
    const a = haversineKm(13.8, 8.99, 13.5, 7.09);
    const b = haversineKm(13.5, 7.09, 13.8, 8.99);
    expect(a).toBeCloseTo(b, 9);
  });

  it('handles antimeridian-spanning points without NaN', () => {
    expect(Number.isFinite(haversineKm(0, 179.9, 0, -179.9))).toBe(true);
  });

  it('gives half the circumference for antipodes', () => {
    expect(haversineKm(0, 0, 0, 180)).toBeCloseTo(Math.PI * 6371, 0);
  });
});

describe('coarsenCoordinate', () => {
  it('rounds to a ~1.1km grid by default', () => {
    expect(coarsenCoordinate(13.806912)).toBe(13.81);
    expect(coarsenCoordinate(8.988134)).toBe(8.99);
  });

  it('keeps negative coordinates negative', () => {
    expect(coarsenCoordinate(-17.4441)).toBe(-17.44);
  });

  it('discards precision that could identify a household', () => {
    // Two points 30m apart must not be distinguishable in public output.
    expect(coarsenCoordinate(13.80691)).toBe(coarsenCoordinate(13.80718));
  });
});

describe('scoreToTriage', () => {
  it('maps scores onto the documented bands', () => {
    expect(scoreToTriage(100)).toBe('urgent');
    expect(scoreToTriage(75)).toBe('urgent');
    expect(scoreToTriage(74)).toBe('refer');
    expect(scoreToTriage(50)).toBe('refer');
    expect(scoreToTriage(49)).toBe('monitor');
    expect(scoreToTriage(25)).toBe('monitor');
    expect(scoreToTriage(24)).toBe('healthy');
    expect(scoreToTriage(0)).toBe('healthy');
  });
});
