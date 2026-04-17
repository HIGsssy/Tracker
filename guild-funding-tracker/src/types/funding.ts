// Shared types for the calculation and render pipeline.
// No DB types. No discord.js client types. Pure data shapes.

export interface FundingInputs {
  totalFunded: number;   // sum of donation amounts for the current month
  hourlyCost: number;    // per-guild hourly cost
  nowUtc: Date;          // injectable wall clock — allows deterministic tests
}

export interface FundingState {
  monthKey: string;         // YYYY-MM, UTC
  monthHours: number;       // total hours in the calendar month
  fundedHours: number;      // totalFunded / hourlyCost
  hoursElapsed: number;     // hours since UTC month start at nowUtc
  hoursLeft: number;        // max(0, fundedHours - hoursElapsed) — derived, never stored
  percentageFunded: number; // 0–100, capped; internal name — maps to "Monthly Coverage" in embed ONLY
  isFullyFunded: boolean;   // fundedHours >= monthHours
}

// Minimal config shape the embed builder needs.
// Decoupled from the DB schema type so the renderer has no DB dependency.
export interface EmbedConfigInput {
  displayTitle: string;
  updatedAt: string;                           // ISO8601 UTC string → converted to Unix seconds in builder
  publicDisplayMode: 'standard' | 'minimal';  // v1 always 'standard'
}
