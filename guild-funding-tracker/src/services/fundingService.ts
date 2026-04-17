// DB-backed service for guild config and funding totals.
// All queries are scoped by guild_id. No Discord API calls here.

import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { guildTrackerConfig, donationRecord } from '../db/schema';
import { config } from '../config/env';
import { MIN_HOURLY_COST, MAX_HOURLY_COST } from '../constants/validation';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export type GuildTrackerConfigRow = typeof guildTrackerConfig.$inferSelect;

export interface UpsertConfigParams {
  enabled?: boolean;
  trackerChannelId?: string | null;
  trackerMessageId?: string | null;
  hourlyCost?: number;
  displayTitle?: string;
  updatedAt?: string;
}

// Validates hourly_cost against MIN/MAX bounds — defense-in-depth, called before every DB write.
function validateHourlyCost(value: number): void {
  if (!Number.isFinite(value) || value < MIN_HOURLY_COST || value > MAX_HOURLY_COST) {
    throw new ValidationError(
      `Hourly cost must be between $${MIN_HOURLY_COST} and $${MAX_HOURLY_COST}.`,
    );
  }
}

export function getGuildConfig(guildId: string): GuildTrackerConfigRow | null {
  const rows = db
    .select()
    .from(guildTrackerConfig)
    .where(eq(guildTrackerConfig.guildId, guildId))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

// Creates a new config row or updates an existing one. Never creates duplicates.
// guild_id is UNIQUE in the table — drizzle update targets by guild_id, insert is only on first call.
export function upsertGuildConfig(
  guildId: string,
  partial: UpsertConfigParams,
): GuildTrackerConfigRow {
  if (partial.hourlyCost !== undefined) {
    validateHourlyCost(partial.hourlyCost);
  }

  const now = partial.updatedAt ?? new Date().toISOString();
  const existing = getGuildConfig(guildId);

  if (existing) {
    const updates: Record<string, unknown> = { updatedAt: now };
    if (partial.enabled !== undefined) updates['enabled'] = partial.enabled;
    if (partial.trackerChannelId !== undefined) updates['trackerChannelId'] = partial.trackerChannelId;
    if (partial.trackerMessageId !== undefined) updates['trackerMessageId'] = partial.trackerMessageId;
    if (partial.hourlyCost !== undefined) updates['hourlyCost'] = partial.hourlyCost;
    if (partial.displayTitle !== undefined) updates['displayTitle'] = partial.displayTitle;

    db.update(guildTrackerConfig)
      .set(updates)
      .where(eq(guildTrackerConfig.guildId, guildId))
      .run();
  } else {
    db.insert(guildTrackerConfig)
      .values({
        guildId,
        enabled: partial.enabled ?? true,
        trackerChannelId: partial.trackerChannelId ?? null,
        trackerMessageId: partial.trackerMessageId ?? null,
        hourlyCost: partial.hourlyCost ?? config.DEFAULT_HOURLY_COST,
        displayTitle: partial.displayTitle ?? 'Server Funding',
        publicDisplayMode: 'standard',
        hidePublicDollarValues: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  return getGuildConfig(guildId)!;
}

// Returns 0 when no donation records exist for the guild/month — never null.
export function getMonthTotal(guildId: string, monthKey: string): number {
  const rows = db
    .select({ total: sql<number>`COALESCE(SUM(${donationRecord.amount}), 0)` })
    .from(donationRecord)
    .where(
      and(
        eq(donationRecord.guildId, guildId),
        eq(donationRecord.monthKey, monthKey),
      ),
    )
    .all();
  return rows[0]?.total ?? 0;
}
