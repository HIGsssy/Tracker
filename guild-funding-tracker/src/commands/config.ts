// /funding config — view or update guild tracker configuration settings.
// With no options: shows current config as ephemeral embed.
// With options: updates the provided fields and refreshes the tracker.

import { EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { getGuildConfig, upsertGuildConfig, ValidationError } from '../services/fundingService';
import { refreshTracker, TrackerError } from '../services/trackerService';

export async function handleConfig(interaction: ChatInputCommandInteraction): Promise<void> {
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

    const titleOption = interaction.options.getString('title');
    const displayModeOption = interaction.options.getString('display_mode') as
      | 'standard'
      | 'minimal'
      | null;

    const hasUpdates = titleOption !== null || displayModeOption !== null;

    if (!hasUpdates) {
      // View mode — show current configuration.
      const cfg = getGuildConfig(interaction.guildId);
      if (!cfg) {
        await interaction.editReply(
          'Funding tracker is not configured for this server. Run `/funding setup` to get started.',
        );
        return;
      }

      const updatedAtUnix = Math.floor(new Date(cfg.updatedAt).getTime() / 1000);
      const embed = new EmbedBuilder()
        .setTitle('Funding Tracker Configuration')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Display Title', value: cfg.displayTitle, inline: true },
          { name: 'Hourly Cost', value: `$${cfg.hourlyCost}/hr`, inline: true },
          { name: 'Display Mode', value: cfg.publicDisplayMode, inline: true },
          {
            name: 'Tracker Channel',
            value: cfg.trackerChannelId ? `<#${cfg.trackerChannelId}>` : 'Not configured',
            inline: true,
          },
          { name: 'Enabled', value: cfg.enabled ? 'Yes' : 'No', inline: true },
          { name: 'Last Updated', value: `<t:${updatedAtUnix}:R>`, inline: true },
        );

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Update mode — persist changes and refresh tracker.
    const updates: { displayTitle?: string; publicDisplayMode?: 'standard' | 'minimal' } = {};
    if (titleOption !== null) updates.displayTitle = titleOption;
    if (displayModeOption !== null) updates.publicDisplayMode = displayModeOption;

    upsertGuildConfig(interaction.guildId, updates);
    await refreshTracker(interaction.guildId, interaction.client);
    await interaction.editReply('Configuration updated. Tracker refreshed.');
  } catch (err) {
    if (err instanceof ValidationError) {
      await interaction.editReply(err.message).catch(() => {});
      return;
    }
    if (err instanceof TrackerError) {
      await interaction.editReply(`Tracker error: ${err.message}`).catch(() => {});
      return;
    }
    console.error('[config] Unhandled error:', err);
    await interaction
      .editReply('Something went wrong. Please try again or contact the bot admin.')
      .catch(() => {});
  }
}
