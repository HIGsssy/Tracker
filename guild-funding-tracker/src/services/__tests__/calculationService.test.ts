import { describe, it, expect } from 'vitest';
import {
  getCurrentMonthKey,
  getPreviousMonthKey,
  getMonthBounds,
  getMonthHours,
  computeFundingState,
} from '../calculationService';

// ---------------------------------------------------------------------------
// getCurrentMonthKey
// ---------------------------------------------------------------------------
describe('getCurrentMonthKey', () => {
  it('returns YYYY-MM for a mid-month UTC date', () => {
    expect(getCurrentMonthKey(new Date('2026-04-15T12:00:00.000Z'))).toBe('2026-04');
  });

  it('returns the correct key at the last instant of a month (UTC)', () => {
    expect(getCurrentMonthKey(new Date('2026-04-30T23:59:59.999Z'))).toBe('2026-04');
  });

  it('returns the next month key at the first instant of the new month (UTC)', () => {
    expect(getCurrentMonthKey(new Date('2026-05-01T00:00:00.000Z'))).toBe('2026-05');
  });

  it('zero-pads single-digit months', () => {
    expect(getCurrentMonthKey(new Date('2026-01-15T00:00:00.000Z'))).toBe('2026-01');
  });

  it('handles December correctly', () => {
    expect(getCurrentMonthKey(new Date('2025-12-31T23:59:59.999Z'))).toBe('2025-12');
  });
});

// ---------------------------------------------------------------------------
// getPreviousMonthKey
// ---------------------------------------------------------------------------
describe('getPreviousMonthKey', () => {
  it('returns the previous month for a mid-year date', () => {
    expect(getPreviousMonthKey(new Date('2026-04-17T00:00:00.000Z'))).toBe('2026-03');
  });

  it('wraps January → December of the previous year', () => {
    expect(getPreviousMonthKey(new Date('2026-01-15T00:00:00.000Z'))).toBe('2025-12');
  });

  it('handles December correctly', () => {
    expect(getPreviousMonthKey(new Date('2025-12-01T00:00:00.000Z'))).toBe('2025-11');
  });

  it('handles February correctly', () => {
    expect(getPreviousMonthKey(new Date('2026-02-01T00:00:00.000Z'))).toBe('2026-01');
  });
});

// ---------------------------------------------------------------------------
// getMonthBounds
// ---------------------------------------------------------------------------
describe('getMonthBounds', () => {
  it('returns correct start and end for April 2026', () => {
    const { start, end } = getMonthBounds('2026-04');
    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('wraps December end to January of the next year', () => {
    const { start, end } = getMonthBounds('2025-12');
    expect(start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns correct start for January', () => {
    const { start } = getMonthBounds('2026-01');
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// getMonthHours — must handle all real month lengths
// ---------------------------------------------------------------------------
describe('getMonthHours', () => {
  it('April 2026 has 720 hours (30 days)', () => {
    expect(getMonthHours('2026-04')).toBe(720);
  });

  it('January 2026 has 744 hours (31 days)', () => {
    expect(getMonthHours('2026-01')).toBe(744);
  });

  it('February 2026 has 672 hours (28 days — non-leap year)', () => {
    // 2026 is not a leap year: 2026 / 4 = 506.5
    expect(getMonthHours('2026-02')).toBe(672);
  });

  it('February 2024 has 696 hours (29 days — leap year)', () => {
    // 2024 is a leap year: divisible by 4, not by 100
    expect(getMonthHours('2024-02')).toBe(696);
  });

  it('July 2026 has 744 hours (31 days)', () => {
    expect(getMonthHours('2026-07')).toBe(744);
  });

  it('December 2025 has 744 hours (31 days)', () => {
    expect(getMonthHours('2025-12')).toBe(744);
  });
});

// ---------------------------------------------------------------------------
// computeFundingState
// ---------------------------------------------------------------------------
describe('computeFundingState', () => {
  // Reference anchor: April 2026, 7 days in (168 hours elapsed)
  const aprilStart = new Date('2026-04-01T00:00:00.000Z');
  const sevenDaysIn = new Date('2026-04-08T00:00:00.000Z'); // 168 hours elapsed

  it('zero funding: fundedHours=0, hoursLeft=0, percentageFunded=0, isFullyFunded=false', () => {
    const state = computeFundingState({ totalFunded: 0, hourlyCost: 0.06, nowUtc: sevenDaysIn });
    expect(state.fundedHours).toBe(0);
    expect(state.hoursLeft).toBe(0);
    expect(state.percentageFunded).toBe(0);
    expect(state.isFullyFunded).toBe(false);
    expect(state.monthKey).toBe('2026-04');
  });

  it('partial funding with hours remaining', () => {
    // 50 / 0.06 = 833.33 funded hours; 168 elapsed; hoursLeft = 665.33
    const state = computeFundingState({ totalFunded: 50, hourlyCost: 0.06, nowUtc: sevenDaysIn });
    expect(state.fundedHours).toBeCloseTo(833.33, 1);
    expect(state.hoursLeft).toBeCloseTo(665.33, 1);
    expect(state.percentageFunded).toBe(100); // capped — 833/720 > 100%
    expect(state.isFullyFunded).toBe(true);
  });

  it('partial funding below 100% coverage', () => {
    // 15 / 0.06 = 250 funded hours; April = 720 hours; coverage = 34.72%
    const state = computeFundingState({ totalFunded: 15, hourlyCost: 0.06, nowUtc: sevenDaysIn });
    expect(state.fundedHours).toBeCloseTo(250, 5);
    expect(state.percentageFunded).toBeCloseTo(34.72, 1);
    expect(state.isFullyFunded).toBe(false);
    expect(state.hoursLeft).toBeCloseTo(250 - 168, 5);
  });

  it('full funding: percentageFunded=100, isFullyFunded=true', () => {
    // 43.20 / 0.06 = 720 funded hours = exactly April's month_hours
    const state = computeFundingState({ totalFunded: 43.20, hourlyCost: 0.06, nowUtc: aprilStart });
    expect(state.fundedHours).toBeCloseTo(720, 4);
    expect(state.percentageFunded).toBe(100);
    expect(state.isFullyFunded).toBe(true);
  });

  it('overfunded: percentageFunded is capped at 100', () => {
    // 100 / 0.06 = 1666.67 funded hours, far exceeding 720 month hours
    const state = computeFundingState({ totalFunded: 100, hourlyCost: 0.06, nowUtc: aprilStart });
    expect(state.percentageFunded).toBe(100);
    expect(state.fundedHours).toBeCloseTo(1666.67, 1);
    expect(state.isFullyFunded).toBe(true);
  });

  /**
   * KEY SCENARIO — proves the model: coverage > 0% while hoursLeft = 0.
   *
   * This is why both "Monthly Coverage" and "Hours Left" must always be shown separately.
   * Showing only one field would give an incomplete or misleading picture.
   *
   * Setup: totalFunded=$15 at $0.06/hr → 250 funded hours
   *   monthHours = 720  → percentageFunded = 34.72% (non-zero)
   *   hoursElapsed = 300 (12.5 days into April, past the 250-hour mark)
   *   hoursLeft = max(0, 250 - 300) = 0
   */
  it('exhausted coverage: percentageFunded > 0 while hoursLeft = 0', () => {
    // 2026-04-13T12:00:00.000Z = 300 hours after April 1st (12 days + 12 hours)
    const twelveDaysHalfIn = new Date('2026-04-13T12:00:00.000Z');
    const state = computeFundingState({ totalFunded: 15, hourlyCost: 0.06, nowUtc: twelveDaysHalfIn });

    expect(state.hoursElapsed).toBeCloseTo(300, 4);
    expect(state.hoursLeft).toBe(0);                        // floored — coverage exhausted
    expect(state.percentageFunded).toBeGreaterThan(0);      // still ~34.7%
    expect(state.percentageFunded).toBeCloseTo(34.72, 1);
    expect(state.isFullyFunded).toBe(false);
  });

  it('month key is derived from nowUtc, not hardcoded', () => {
    const state = computeFundingState({
      totalFunded: 10,
      hourlyCost: 0.06,
      nowUtc: new Date('2025-12-15T00:00:00.000Z'),
    });
    expect(state.monthKey).toBe('2025-12');
    expect(state.monthHours).toBe(744); // December = 31 days
  });

  it('monthHours reflects the actual calendar month length', () => {
    const stateApril = computeFundingState({ totalFunded: 10, hourlyCost: 0.06, nowUtc: sevenDaysIn });
    expect(stateApril.monthHours).toBe(720); // April = 30 days

    const stateFeb = computeFundingState({
      totalFunded: 10,
      hourlyCost: 0.06,
      nowUtc: new Date('2024-02-15T00:00:00.000Z'),
    });
    expect(stateFeb.monthHours).toBe(696); // Feb 2024 = leap year, 29 days
  });

  it('hoursElapsed is zero at the exact month start', () => {
    const state = computeFundingState({ totalFunded: 10, hourlyCost: 0.06, nowUtc: aprilStart });
    expect(state.hoursElapsed).toBe(0);
  });

  it('throws on hourlyCost = 0', () => {
    expect(() =>
      computeFundingState({ totalFunded: 10, hourlyCost: 0, nowUtc: sevenDaysIn }),
    ).toThrow();
  });

  it('throws on negative hourlyCost', () => {
    expect(() =>
      computeFundingState({ totalFunded: 10, hourlyCost: -1, nowUtc: sevenDaysIn }),
    ).toThrow();
  });

  it('throws on NaN hourlyCost', () => {
    expect(() =>
      computeFundingState({ totalFunded: 10, hourlyCost: NaN, nowUtc: sevenDaysIn }),
    ).toThrow();
  });

  it('throws on Infinity hourlyCost', () => {
    expect(() =>
      computeFundingState({ totalFunded: 10, hourlyCost: Infinity, nowUtc: sevenDaysIn }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// computeFundingState — displayHoursLeft capping
// ---------------------------------------------------------------------------
describe('computeFundingState displayHoursLeft', () => {
  // April 19 00:00 UTC = 18 days elapsed = 432h; monthHoursLeft = 720 - 432 = 288h
  const eighteenDaysIn = new Date('2026-04-19T00:00:00.000Z');
  const sevenDaysIn    = new Date('2026-04-08T00:00:00.000Z'); // 168h elapsed

  it('displayHoursLeft equals funded_hours_left when it is less than calendar hours remaining', () => {
    // 15 / 0.06 = 250 funded hours; 168h elapsed; hoursLeft=82; monthHoursLeft=552; display=82
    const state = computeFundingState({ totalFunded: 15, hourlyCost: 0.06, nowUtc: sevenDaysIn });
    expect(state.hoursLeft).toBeCloseTo(82, 1);
    expect(state.monthHoursLeft).toBeCloseTo(552, 1);
    expect(state.displayHoursLeft).toBeCloseTo(82, 1); // min(82, 552) — funded wins
  });

  it('displayHoursLeft is capped to monthHoursLeft when funded runtime exceeds calendar remainder', () => {
    // 50 / 0.06 = 833.33 funded hours; 432h elapsed; hoursLeft=401.33; monthHoursLeft=288; display=288
    const state = computeFundingState({ totalFunded: 50, hourlyCost: 0.06, nowUtc: eighteenDaysIn });
    expect(state.hoursLeft).toBeCloseTo(401.33, 1);
    expect(state.monthHoursLeft).toBeCloseTo(288, 1);
    expect(state.displayHoursLeft).toBeCloseTo(288, 1); // min(401.33, 288) — calendar wins
  });

  it('100%-funded month late in the month: displayHoursLeft shows remaining calendar hours only', () => {
    // Exactly 100% funded (43.20 / 0.06 = 720h) with 12 days remaining (432h elapsed)
    const state = computeFundingState({ totalFunded: 43.20, hourlyCost: 0.06, nowUtc: eighteenDaysIn });
    expect(state.isFullyFunded).toBe(true);
    expect(state.monthHoursLeft).toBeCloseTo(288, 1);
    expect(state.displayHoursLeft).toBeCloseTo(288, 1);
  });

  it('overfunded: displayHoursLeft is always capped to remaining calendar hours', () => {
    // 100 / 0.06 = 1666.67 funded hours; 432h elapsed; hoursLeft=1234.67; monthHoursLeft=288
    const state = computeFundingState({ totalFunded: 100, hourlyCost: 0.06, nowUtc: eighteenDaysIn });
    expect(state.hoursLeft).toBeCloseTo(1234.67, 1);
    expect(state.monthHoursLeft).toBeCloseTo(288, 1);
    expect(state.displayHoursLeft).toBeCloseTo(288, 1); // never shows funded surplus
  });

  it('monthHoursLeft is zero at the last instant of the month', () => {
    const lastInstant = new Date('2026-04-30T23:59:59.999Z');
    const state = computeFundingState({ totalFunded: 10, hourlyCost: 0.06, nowUtc: lastInstant });
    expect(state.monthHoursLeft).toBeCloseTo(0, 1);
    expect(state.displayHoursLeft).toBe(0);
  });

  it('Monthly Coverage (percentageFunded) is unaffected by the displayHoursLeft cap', () => {
    // Overfunded late in month: coverage must still be 100%, not reduced by the display cap
    const state = computeFundingState({ totalFunded: 50, hourlyCost: 0.06, nowUtc: eighteenDaysIn });
    expect(state.percentageFunded).toBe(100);
    expect(state.displayHoursLeft).toBeCloseTo(288, 1); // display is capped
  });
});
