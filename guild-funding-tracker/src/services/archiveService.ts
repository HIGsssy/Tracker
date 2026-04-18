// DB-backed archive service for monthly funding snapshots.
// Writes to month_archive. Never deletes or modifies donation records.
// No Discord API calls here.

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { monthArchive } from '../db/schema';
import { getGuildConfig, getAllEnabledConfigs, getMonthTotal } from './fundingService';
import { getMonthHours } from './calculationService';

export type MonthArchiveRow = typeof monthArchive.$inferSelect;

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/**
 * Archives the funding state for a given guild and month.
 * This is a snapshot — donation records are never touched.
 * Idempotent: safe to run multiple times for the same guild + month (upsert semantics).
 */
export function archiveMonth(guildId: string, monthKey: string): void {
  const cfg = getGuildConfig(guildId);
  if (!cfg) {
    throw new ArchiveError(`No config found for guild ${guildId}.`);
  }

  const totalFunded = getMonthTotal(guildId, monthKey);
  const hourlyCostSnapshot = cfg.hourlyCost;
  const fundedHours = totalFunded / hourlyCostSnapshot;
  const monthHours = getMonthHours(monthKey);
  const percentageFunded = Math.min(100, (fundedHours / monthHours) * 100);
  const finalizedAt = new Date().toISOString();

  const existing = getMonthArchive(guildId, monthKey);
  if (existing) {
    db.update(monthArchive)
      .set({ totalFunded, hourlyCostSnapshot, fundedHours, monthHours, percentageFunded, finalizedAt })
      .where(and(eq(monthArchive.guildId, guildId), eq(monthArchive.monthKey, monthKey)))
      .run();
  } else {
    db.insert(monthArchive)
      .values({ guildId, monthKey, totalFunded, hourlyCostSnapshot, fundedHours, monthHours, percentageFunded, finalizedAt })
      .run();
  }
}

/**
 * Archives the specified month for all enabled guilds.
 * Failures are isolated per guild — one failure does not stop the others.
 */
export async function archiveAllGuildsForMonth(monthKey: string): Promise<void> {
  const configs = getAllEnabledConfigs();
  console.log(`[archive] Archiving month ${monthKey} for ${configs.length} enabled guild(s).`);

  for (const cfg of configs) {
    try {
      archiveMonth(cfg.guildId, monthKey);
      console.log(`[archive] Guild ${cfg.guildId}: archived month ${monthKey}.`);
    } catch (err) {
      console.error(`[archive] Guild ${cfg.guildId}: failed to archive month ${monthKey}:`, err);
    }
  }
}

/** Returns the archive row for a specific guild + month, or null if not found. */
export function getMonthArchive(guildId: string, monthKey: string): MonthArchiveRow | null {
  const rows = db
    .select()
    .from(monthArchive)
    .where(and(eq(monthArchive.guildId, guildId), eq(monthArchive.monthKey, monthKey)))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/** Returns the most recent N archive rows for a guild, ordered newest first by month key. */
export function getRecentArchives(guildId: string, limit: number): MonthArchiveRow[] {
  return db
    .select()
    .from(monthArchive)
    .where(eq(monthArchive.guildId, guildId))
    .orderBy(desc(monthArchive.monthKey))
    .limit(limit)
    .all();
}
