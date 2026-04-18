// Hourly embed refresh scheduler.
// Re-renders all guild tracker embeds once per hour, aligned to the UTC clock hour.
// No polling loops. Uses a self-rescheduling single setTimeout.

import type { Client } from 'discord.js';
import { getAllEnabledConfigs } from '../services/fundingService';
import { refreshTracker } from '../services/trackerService';

const HOUR_MS = 3_600_000;

/**
 * Computes milliseconds until the top of the next UTC clock hour.
 * e.g. called at 14:42:30 UTC → returns ms until 15:00:00 UTC.
 */
export function msUntilNextHour(now: Date = new Date()): number {
  const msIntoCurrentHour =
    (now.getUTCMinutes() * 60 + now.getUTCSeconds()) * 1000 + now.getUTCMilliseconds();
  return Math.max(0, HOUR_MS - msIntoCurrentHour);
}

/**
 * Refreshes the tracker embed for all enabled guilds.
 * Exported for direct testing of the callback logic.
 */
export async function runHourlyEmbedRefresh(client: Client): Promise<void> {
  const configs = getAllEnabledConfigs();
  console.log(`[embedRefresh] Hourly refresh — ${configs.length} guild(s).`);
  for (const cfg of configs) {
    if (!cfg.trackerChannelId) continue;
    try {
      await refreshTracker(cfg.guildId, client);
      console.log(`[embedRefresh] Guild ${cfg.guildId}: embed refreshed.`);
    } catch (err) {
      console.error(`[embedRefresh] Guild ${cfg.guildId}: refresh failed:`, err);
    }
  }
}

/**
 * Starts the hourly embed refresh scheduler. Call once from application bootstrap.
 * Each fired timeout schedules the next one — no interval or polling loop.
 */
export function startHourlyEmbedRefreshScheduler(client: Client): void {
  function scheduleNext(): void {
    const ms = msUntilNextHour();
    const mins = Math.round(ms / 60_000);
    console.log(`[embedRefresh] Next hourly refresh scheduled in ~${mins}m.`);
    setTimeout(async () => {
      try {
        await runHourlyEmbedRefresh(client);
      } catch (err) {
        console.error('[embedRefresh] Unexpected error during hourly refresh:', err);
      }
      scheduleNext();
    }, ms);
  }
  scheduleNext();
}
