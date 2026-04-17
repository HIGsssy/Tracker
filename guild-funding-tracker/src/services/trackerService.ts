// Orchestrates the render + post/edit cycle for a guild's tracker embed.
// No business logic lives here — only Discord posting and DB message-ID bookkeeping.

import { ChannelType, type Client, type TextChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { guildTrackerConfig } from '../db/schema';
import { getGuildConfig, getMonthTotal } from './fundingService';
import { computeFundingState, getCurrentMonthKey } from './calculationService';
import { buildFundingEmbed } from '../renderer/embedBuilder';
import type { EmbedConfigInput } from '../types/funding';

export class TrackerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackerError';
  }
}

// Returns true if the error is a Discord API error with the given code.
function isDiscordApiError(err: unknown, code: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === code
  );
}

/**
 * Loads guild config, computes current funding state, builds the embed, and
 * posts or edits the tracker message. Stores the resulting message ID in DB.
 *
 * Post vs edit logic:
 * - If tracker_message_id exists: attempt edit.
 * - If edit fails with Unknown Message (10008) or Unknown Channel (10003): fall through to post new.
 * - If no valid message exists: post new message, store ID.
 * - On success (either path): update updated_at in DB.
 */
export async function refreshTracker(guildId: string, client: Client): Promise<void> {
  const cfg = getGuildConfig(guildId);

  if (!cfg) {
    throw new TrackerError('Guild tracker is not configured. Run /funding setup first.');
  }
  if (!cfg.enabled) {
    throw new TrackerError('Guild tracker is disabled.');
  }
  if (!cfg.trackerChannelId) {
    throw new TrackerError('No tracker channel configured. Run /funding setup first.');
  }

  const now = new Date();
  const monthKey = getCurrentMonthKey(now);
  const totalFunded = getMonthTotal(guildId, monthKey);
  const nowIso = now.toISOString();

  const state = computeFundingState({
    totalFunded,
    hourlyCost: cfg.hourlyCost,
    nowUtc: now,
  });

  const embedConfig: EmbedConfigInput = {
    displayTitle: cfg.displayTitle,
    updatedAt: nowIso,
    publicDisplayMode: cfg.publicDisplayMode,
  };
  const embed = buildFundingEmbed(embedConfig, state);

  // Fetch the tracker channel.
  let channel: TextChannel;
  try {
    const fetched = await client.channels.fetch(cfg.trackerChannelId);
    if (!fetched || fetched.type !== ChannelType.GuildText) {
      throw new TrackerError(
        `Channel ${cfg.trackerChannelId} is not a text channel or could not be fetched.`,
      );
    }
    channel = fetched as TextChannel;
  } catch (err) {
    if (isDiscordApiError(err, 10003)) {
      // Unknown Channel — clear stored IDs so admin knows to re-run setup.
      db.update(guildTrackerConfig)
        .set({ trackerChannelId: null, trackerMessageId: null })
        .where(eq(guildTrackerConfig.guildId, guildId))
        .run();
      throw new TrackerError(
        'Tracker channel no longer exists. Run /funding setup to reconfigure.',
      );
    }
    throw err;
  }

  // Try editing the existing message; fall back to posting new if message is gone.
  let existingMessageId: string | null = cfg.trackerMessageId;

  if (existingMessageId) {
    try {
      await channel.messages.edit(existingMessageId, { embeds: [embed] });
      db.update(guildTrackerConfig)
        .set({ updatedAt: nowIso })
        .where(eq(guildTrackerConfig.guildId, guildId))
        .run();
      return;
    } catch (err) {
      if (isDiscordApiError(err, 10008) || isDiscordApiError(err, 10003)) {
        // Message is gone — fall through to post a new one.
        existingMessageId = null;
      } else {
        throw err;
      }
    }
  }

  // Post a new message and store its ID.
  const message = await channel.send({ embeds: [embed] });
  db.update(guildTrackerConfig)
    .set({ trackerMessageId: message.id, updatedAt: nowIso })
    .where(eq(guildTrackerConfig.guildId, guildId))
    .run();
}
