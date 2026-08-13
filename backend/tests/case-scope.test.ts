/**
 * Access-control rules for listing cases.
 *
 * The service-role Supabase key bypasses row-level security, so this function
 * is the only thing keeping one health worker's patient records away from
 * another's. Treated accordingly.
 */

import { describe, expect, it } from 'vitest';
import { resolveCaseScope } from '../src/routes/cases';
import { AppError } from '../src/lib/errors';

const worker = { id: 'chw-1', role: 'chw' as const, region: 'zinder' };
const supervisor = { id: 'sup-1', role: 'supervisor' as const, region: 'zinder' };

describe('resolveCaseScope', () => {
  it('restricts an ordinary CHW to their own cases', () => {
    expect(resolveCaseScope(worker, undefined)).toEqual({
      column: 'chw_id',
      value: 'chw-1',
    });
  });

  it('ignores a region parameter from an ordinary CHW', () => {
    // A worker cannot widen their scope by naming a region.
    expect(resolveCaseScope(worker, 'maradi')).toEqual({
      column: 'chw_id',
      value: 'chw-1',
    });
  });

  it('scopes a supervisor to their own region by default', () => {
    expect(resolveCaseScope(supervisor, undefined)).toEqual({
      column: 'region',
      value: 'zinder',
    });
  });

  it('allows a supervisor to restate their own region', () => {
    expect(resolveCaseScope(supervisor, 'zinder')).toEqual({
      column: 'region',
      value: 'zinder',
    });
  });

  it('refuses a supervisor asking for another region', () => {
    // Regression: this previously returned the requested region verbatim, so
    // ?region=maradi handed a Zinder supervisor every case in Maradi.
    expect(() => resolveCaseScope(supervisor, 'maradi')).toThrow(AppError);
    try {
      resolveCaseScope(supervisor, 'maradi');
    } catch (err) {
      expect((err as AppError).status).toBe(403);
    }
  });

  it('refuses an empty region rather than treating it as absent', () => {
    expect(() => resolveCaseScope(supervisor, '')).toThrow(AppError);
  });
});
