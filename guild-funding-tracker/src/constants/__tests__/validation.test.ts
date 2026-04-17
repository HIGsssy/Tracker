// Tests for the mathematical implications of the validation bounds.
// Constant value checks live in src/__tests__/smoke.test.ts — not duplicated here.

import { describe, it, expect } from 'vitest';
import { MIN_HOURLY_COST, MAX_HOURLY_COST } from '../validation';
import { computeFundingState } from '../../services/calculationService';

const NOW = new Date('2026-04-15T12:00:00.000Z');

// ---------------------------------------------------------------------------
// computeFundingState guard — invalid hourlyCost values
// ---------------------------------------------------------------------------
describe('computeFundingState input guard — hourlyCost', () => {
  it('throws on hourlyCost = 0 (division by zero)', () => {
    expect(() =>
      computeFundingState({ totalFunded: 10, hourlyCost: 0, nowUtc: NOW }),
    ).toThrow();
  });

  it('throws on negative hourlyCost', () => {
    expect(() =>
      computeFundingState({ totalFunded: 10, hourlyCost: -0.001, nowUtc: NOW }),
    ).toThrow();
  });

  it('throws on NaN hourlyCost', () => {
    expect(() =>
      computeFundingState({ totalFunded: 10, hourlyCost: NaN, nowUtc: NOW }),
    ).toThrow();
  });

  it('throws on Infinity hourlyCost', () => {
    expect(() =>
      computeFundingState({ totalFunded: 10, hourlyCost: Infinity, nowUtc: NOW }),
    ).toThrow();
  });

  it('throws on -Infinity hourlyCost', () => {
    expect(() =>
      computeFundingState({ totalFunded: 10, hourlyCost: -Infinity, nowUtc: NOW }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Boundary math at MIN_HOURLY_COST and MAX_HOURLY_COST
// ---------------------------------------------------------------------------
describe('hourly cost bounds — mathematical implications', () => {
  it('MIN_HOURLY_COST (0.001) produces a finite fundedHours result', () => {
    // $1 at $0.001/hr = 1000 funded hours — large but finite and representable
    const state = computeFundingState({ totalFunded: 1, hourlyCost: MIN_HOURLY_COST, nowUtc: NOW });
    expect(Number.isFinite(state.fundedHours)).toBe(true);
    expect(state.fundedHours).toBe(1000);
  });

  it('MAX_HOURLY_COST (1000.00) produces a correct fundedHours result', () => {
    // $1000 at $1000/hr = 1 funded hour
    const state = computeFundingState({ totalFunded: 1000, hourlyCost: MAX_HOURLY_COST, nowUtc: NOW });
    expect(Number.isFinite(state.fundedHours)).toBe(true);
    expect(state.fundedHours).toBeCloseTo(1, 10);
  });

  it('value just above zero but below MIN_HOURLY_COST still satisfies the guard (guard checks <= 0)', () => {
    // 0.0001 is positive, so computeFundingState does NOT throw —
    // enforcement of the MIN_HOURLY_COST bound is the service layer's job (Phase 3)
    const state = computeFundingState({ totalFunded: 1, hourlyCost: 0.0001, nowUtc: NOW });
    expect(Number.isFinite(state.fundedHours)).toBe(true);
  });

  it('percentageFunded is always capped at 100 regardless of hourlyCost', () => {
    // Cheap cost → enormous funded hours → coverage must still cap at 100
    const state = computeFundingState({ totalFunded: 1000, hourlyCost: MIN_HOURLY_COST, nowUtc: NOW });
    expect(state.percentageFunded).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Progress bar tests
// ---------------------------------------------------------------------------
import { buildProgressBar } from '../../renderer/progressBar';

describe('buildProgressBar', () => {
  it('0% produces all empty blocks', () => {
    const bar = buildProgressBar(0);
    expect(bar).toBe('░'.repeat(20));
    expect(bar).not.toContain('█');
  });

  it('100% produces all filled blocks', () => {
    const bar = buildProgressBar(100);
    expect(bar).toBe('█'.repeat(20));
    expect(bar).not.toContain('░');
  });

  it('65% produces 13 filled and 7 empty at default width 20', () => {
    const bar = buildProgressBar(65);
    expect(bar).toBe('█████████████░░░░░░░');
    expect(bar.length).toBe(20);
  });

  it('negative percentage clamps to 0%', () => {
    expect(buildProgressBar(-10)).toBe(buildProgressBar(0));
  });

  it('percentage above 100 clamps to 100%', () => {
    expect(buildProgressBar(110)).toBe(buildProgressBar(100));
  });

  it('respects a custom width', () => {
    const bar = buildProgressBar(50, 10);
    expect(bar.length).toBe(10);
    expect(bar).toBe('█████░░░░░');
  });
});
