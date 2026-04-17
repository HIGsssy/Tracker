import { describe, it, expect } from 'vitest';
import {
  MIN_HOURLY_COST,
  MAX_HOURLY_COST,
  MIN_DONATION_AMOUNT,
  MAX_DONATION_AMOUNT,
  STALE_EMBED_DEFAULT_THRESHOLD_HOURS,
} from '../constants/validation';

describe('validation constants', () => {
  it('are defined with correct values', () => {
    expect(MIN_HOURLY_COST).toBe(0.001);
    expect(MAX_HOURLY_COST).toBe(1000.00);
    expect(MIN_DONATION_AMOUNT).toBe(0.01);
    expect(MAX_DONATION_AMOUNT).toBe(100_000.00);
    expect(STALE_EMBED_DEFAULT_THRESHOLD_HOURS).toBe(6);
  });

  it('MIN_HOURLY_COST is positive (prevents division near zero)', () => {
    expect(MIN_HOURLY_COST).toBeGreaterThan(0);
  });

  it('MAX_HOURLY_COST is greater than MIN_HOURLY_COST', () => {
    expect(MAX_HOURLY_COST).toBeGreaterThan(MIN_HOURLY_COST);
  });
});
