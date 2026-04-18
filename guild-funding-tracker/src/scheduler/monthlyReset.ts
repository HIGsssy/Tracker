// Monthly archive scheduler.
// Fires at 00:01 UTC on the 1st of each month.
// No polling loops. No interval timers. Uses a self-rescheduling single setTimeout.

import type { Client } from 'discord.js';
import { getPreviousMonthKey } from '../services/calculationService';
import { archiveAllGuildsForMonth } from '../services/archiveService';
import { getAllEnabledConfigs } from '../services/fundingService';
import { refreshTracker } from '../services/trackerService';

/** Computes milliseconds until 00:01 UTC on the 1st of next month. */
export function msUntilNextMonthlyReset(now: Date = new Date()): number {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1, // overflow-safe: Dec (month=11, +1=12) → Jan of next year via Date.UTC
      1,   // 1st day of month
      0,   // 00 hours
      1,   // 01 minutes — one minute past midnight, safely past the month boundary
      0,   // 00 seconds
    ),
  );
  return Math.max(0, next.getTime() - now.getTime());
}

/**
 * Archives the previous month for all guilds, then refreshes their tracker embeds.
 * Exported for direct testing of the callback logic.
 */
export async function runMonthlyReset(client: Client): Promise<void> {
  const prevMonthKey = getPreviousMonthKey(new Date());
  console.log(`[scheduler] Running monthly archive for ${prevMonthKey}.`);

  await archiveAllGuildsForMonth(prevMonthKey);

  const configs = getAllEnabledConfigs();
  for (const cfg of configs) {
    if (!cfg.trackerChannelId) continue;
    try {
      await refreshTracker(cfg.guildId, client);
      console.log(`[scheduler] Guild ${cfg.guildId}: tracker refreshed.`);
    } catch (err) {
      console.error(`[scheduler] Guild ${cfg.guildId}: tracker refresh failed:`, err);
    }
  }
}

/**
 * Starts the monthly reset scheduler. Call once from application bootstrap.
 * Each fired timeout schedules the next one — no interval or polling loop.
 */
export function startMonthlyResetScheduler(client: Client): void {
  function scheduleNext(): void {
    const ms = msUntilNextMonthlyReset();
    const hours = Math.round(ms / 3_600_000);
    console.log(`[scheduler] Next monthly archive scheduled in ~${hours}h.`);
    setTimeout(async () => {
      try {
        await runMonthlyReset(client);
      } catch (err) {
        console.error('[scheduler] Unexpected error during monthly reset:', err);
      }
      scheduleNext();
    }, ms);
  }
  scheduleNext();
}
