// /funding refresh — force re-render and re-post/edit the tracker embed.
// Primary manual recovery command for Phase 5.

import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { getGuildConfig } from '../services/fundingService';
import { refreshTracker, TrackerError } from '../services/trackerService';

export async function handleRefresh(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.editReply(
        'You do not have permission to use this command. (Requires Manage Server)',
      );
      return;
    }

    // Load config before refreshing so we have the channel ID for the repost message.
    const cfg = getGuildConfig(interaction.guildId);
    const channelId = cfg?.trackerChannelId ?? null;

    const result = await refreshTracker(interaction.guildId, interaction.client);

    if (result.action === 'reposted' && channelId) {
      await interaction.editReply(
        `Tracker message was missing and has been re-posted in <#${channelId}>.`,
      );
    } else {
      await interaction.editReply('Tracker refreshed.');
    }
  } catch (err) {
    if (err instanceof TrackerError) {
      await interaction.editReply(`Tracker error: ${err.message}`).catch(() => {});
      return;
    }
    console.error('[refresh] Unhandled error:', err);
    await interaction
      .editReply('Something went wrong. Please try again or contact the bot admin.')
      .catch(() => {});
  }
}
