// DB-backed service for guild config and funding totals.
// All queries are scoped by guild_id. No Discord API calls here.

import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { guildTrackerConfig, donationRecord } from '../db/schema';
import { config } from '../config/env';
import { MIN_HOURLY_COST, MAX_HOURLY_COST, MIN_DONATION_AMOUNT, MAX_DONATION_AMOUNT } from '../constants/validation';
import { getCurrentMonthKey } from './calculationService';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export type GuildTrackerConfigRow = typeof guildTrackerConfig.$inferSelect;
export type DonationRecordRow = typeof donationRecord.$inferSelect;

export interface UpsertConfigParams {
  enabled?: boolean;
  trackerChannelId?: string | null;
  trackerMessageId?: string | null;
  hourlyCost?: number;
  displayTitle?: string;
  publicDisplayMode?: 'standard' | 'minimal';
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
    if (partial.publicDisplayMode !== undefined) updates['publicDisplayMode'] = partial.publicDisplayMode;

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

// Returns all guild tracker configs with enabled = true.
export function getAllEnabledConfigs(): GuildTrackerConfigRow[] {
  return db
    .select()
    .from(guildTrackerConfig)
    .where(eq(guildTrackerConfig.enabled, true))
    .all();
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

// Returns a single donation record by ID, scoped to the guild. Returns null if not found
// or if the record belongs to a different guild.
export function getDonationRecord(guildId: string, recordId: number): DonationRecordRow | null {
  const rows = db
    .select()
    .from(donationRecord)
    .where(and(eq(donationRecord.id, recordId), eq(donationRecord.guildId, guildId)))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

// Returns donation records for the given guild and month, newest first.
export function getMonthRecords(guildId: string, monthKey: string): DonationRecordRow[] {
  return db
    .select()
    .from(donationRecord)
    .where(and(eq(donationRecord.guildId, guildId), eq(donationRecord.monthKey, monthKey)))
    .orderBy(desc(donationRecord.id))
    .all();
}

// Validates that a donation amount is within accepted bounds.
function validateDonationAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('Amount must be a positive finite number.');
  }
  if (amount < MIN_DONATION_AMOUNT) {
    throw new ValidationError(`Amount must be at least $${MIN_DONATION_AMOUNT}.`);
  }
  if (amount > MAX_DONATION_AMOUNT) {
    throw new ValidationError(`Amount cannot exceed $${MAX_DONATION_AMOUNT.toLocaleString()}.`);
  }
}

// Inserts a new donation record for the current UTC month. Returns the inserted row.
export function addDonation(
  guildId: string,
  amount: number,
  createdByUserId: string,
  donorName?: string,
  note?: string,
): DonationRecordRow {
  validateDonationAmount(amount);

  const now = new Date();
  const monthKey = getCurrentMonthKey(now);
  const recordedAt = now.toISOString();

  const rows = db
    .insert(donationRecord)
    .values({
      guildId,
      monthKey,
      amount,
      recordedAt,
      donorName: donorName ?? null,
      note: note ?? null,
      createdByUserId,
    })
    .returning()
    .all();

  return rows[0]!;
}

// Removes a donation record by ID, scoped to the guild. Returns false if not found.
// The guild_id scope prevents cross-guild deletion from any code path.
export function removeDonation(guildId: string, recordId: number): boolean {
  const existing = getDonationRecord(guildId, recordId);
  if (!existing) return false;

  db.delete(donationRecord)
    .where(and(eq(donationRecord.id, recordId), eq(donationRecord.guildId, guildId)))
    .run();

  return true;
}
