// Pure calculation functions — no DB access, no Discord API, no env reads, no hidden state.
// All month arithmetic uses UTC. hours_left is always derived here; it is never stored.

import type { FundingInputs, FundingState } from '../types/funding';

/** Returns the YYYY-MM month key for a given UTC instant. */
export function getCurrentMonthKey(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Returns the YYYY-MM month key for the calendar month before the given UTC instant. */
export function getPreviousMonthKey(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed: 0 = January
  if (month === 0) {
    // January → December of the previous year
    return `${year - 1}-12`;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Returns the UTC start and end instants for a given YYYY-MM month key.
 * End is the first instant of the *next* month, not the last instant of this one.
 * Date.UTC handles month overflow (e.g. month=12 in 2025 → 2026-01-01).
 */
export function getMonthBounds(monthKey: string): { start: Date; end: Date } {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1-indexed

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1)); // overflow-safe: Dec (12) → Jan next year

  return { start, end };
}

/** Returns the exact number of hours in a calendar month (handles 28/29/30/31 day months). */
export function getMonthHours(monthKey: string): number {
  const { start, end } = getMonthBounds(monthKey);
  return (end.getTime() - start.getTime()) / 3_600_000;
}

/**
 * Computes the full funding state from raw inputs.
 *
 * Throws if hourlyCost is not a positive finite number — a zero or negative
 * hourlyCost would produce division-by-zero or nonsensical funded_hours.
 *
 * INV-4: hoursLeft is derived here from (now - monthStart); it is never stored or mutated.
 */
export function computeFundingState(inputs: FundingInputs): FundingState {
  const { totalFunded, hourlyCost, nowUtc } = inputs;

  if (!Number.isFinite(hourlyCost) || hourlyCost <= 0) {
    throw new Error(
      `computeFundingState: hourlyCost must be a positive finite number, got ${hourlyCost}`,
    );
  }

  const monthKey = getCurrentMonthKey(nowUtc);
  const { start: monthStart } = getMonthBounds(monthKey);
  const monthHours = getMonthHours(monthKey);

  const fundedHours = totalFunded / hourlyCost;
  const hoursElapsed = (nowUtc.getTime() - monthStart.getTime()) / 3_600_000;
  const hoursLeft = Math.max(0, fundedHours - hoursElapsed);
  const monthHoursLeft = Math.max(0, monthHours - hoursElapsed);
  const displayHoursLeft = Math.min(hoursLeft, monthHoursLeft);
  const percentageFunded = Math.min(100, (fundedHours / monthHours) * 100);
  const isFullyFunded = fundedHours >= monthHours;

  return {
    monthKey,
    monthHours,
    fundedHours,
    hoursElapsed,
    hoursLeft,
    monthHoursLeft,
    displayHoursLeft,
    percentageFunded,
    isFullyFunded,
  };
}
