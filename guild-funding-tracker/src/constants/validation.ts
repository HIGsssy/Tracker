// Single source of truth for all validation bounds.
// Import these constants everywhere hourly_cost or donation amounts are validated —
// never scatter these numbers inline.

export const MIN_HOURLY_COST = 0.001;        // below this, funded_hours become astronomically large
export const MAX_HOURLY_COST = 1000.00;      // above this, no realistic guild would ever fund

export const MIN_DONATION_AMOUNT = 0.01;
export const MAX_DONATION_AMOUNT = 100_000.00;

export const STALE_EMBED_DEFAULT_THRESHOLD_HOURS = 6;
