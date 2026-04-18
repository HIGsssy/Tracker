// Startup validation and stale-embed refresh.
// Runs once when the Discord client emits the 'ready' event.
//
// Responsibilities:
// 1. Log connected guilds.
// 2. Iterate enabled guild tracker configs.
// 3. Validate tracker channel/message still exist; clear stale IDs on Discord errors.
// 4. Call refreshIfStale for guilds that remain valid after recovery.
//
// Does NOT: archive months, run month reset, post recovery messages to Discord,
// or perform any timer-based operations.

import { ChannelType, type Client, type TextChannel } from 'discord.js';
import { getAllEnabledConfigs, upsertGuildConfig } from '../../services/fundingService';
import { refreshIfStale } from '../../services/trackerService';

function isDiscordApiError(err: unknown, code: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === code
  );
}

export async function handleReady(client: Client<true>): Promise<void> {
  const guildCount = client.guilds.cache.size;
  const guildNames = client.guilds.cache.map((g) => g.name).join(', ');
  console.log(
    `[ready] Connected as ${client.user.tag}. Serving ${guildCount} guild(s)` +
      (guildCount > 0 ? `: ${guildNames}` : '') +
      '.',
  );

  const configs = getAllEnabledConfigs();
  console.log(`[ready] Validating ${configs.length} enabled tracker config(s).`);

  for (const cfg of configs) {
    try {
      if (!cfg.trackerChannelId) {
        // No channel configured — nothing to validate.
        continue;
      }

      let channelStillValid = true;

      try {
        const fetched = await client.channels.fetch(cfg.trackerChannelId);

        if (!fetched || fetched.type !== ChannelType.GuildText) {
          console.warn(
            `[ready] Guild ${cfg.guildId}: tracker channel ${cfg.trackerChannelId} is not a ` +
              `text channel or could not be fetched. Clearing channel and message IDs.`,
          );
          upsertGuildConfig(cfg.guildId, { trackerChannelId: null, trackerMessageId: null });
          channelStillValid = false;
        } else if (cfg.trackerMessageId) {
          // Channel exists — validate the tracker message.
          const textChannel = fetched as TextChannel;
          try {
            await textChannel.messages.fetch(cfg.trackerMessageId);
          } catch (msgErr) {
            if (isDiscordApiError(msgErr, 10008)) {
              console.warn(
                `[ready] Guild ${cfg.guildId}: tracker message ${cfg.trackerMessageId} is gone. ` +
                  `Clearing message ID.`,
              );
              upsertGuildConfig(cfg.guildId, { trackerMessageId: null });
            } else {
              console.warn(
                `[ready] Guild ${cfg.guildId}: error fetching tracker message:`,
                msgErr,
              );
            }
          }
        }
      } catch (chErr) {
        if (isDiscordApiError(chErr, 10003)) {
          console.warn(
            `[ready] Guild ${cfg.guildId}: tracker channel ${cfg.trackerChannelId} no longer ` +
              `exists. Clearing channel and message IDs.`,
          );
          upsertGuildConfig(cfg.guildId, { trackerChannelId: null, trackerMessageId: null });
        } else {
          console.warn(
            `[ready] Guild ${cfg.guildId}: error fetching tracker channel:`,
            chErr,
          );
        }
        channelStillValid = false;
      }

      if (!channelStillValid) {
        continue;
      }

      // Channel (and possibly message) validated — attempt stale embed refresh.
      await refreshIfStale(cfg.guildId, client);
    } catch (err) {
      // Per-guild errors must not crash the startup loop.
      console.error(
        `[ready] Guild ${cfg.guildId}: unexpected error during startup validation:`,
        err,
      );
    }
  }

  console.log('[ready] Startup validation complete.');
}
