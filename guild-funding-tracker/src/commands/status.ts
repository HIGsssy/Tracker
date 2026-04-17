// /funding status — shows current funding state as an ephemeral embed.
// Available to all guild members; admins also see financial details.
// Does NOT refresh the posted tracker embed — that is add/remove's responsibility.

import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { getGuildConfig, getMonthTotal, getMonthRecords } from '../services/fundingService';
import { computeFundingState, getCurrentMonthKey } from '../services/calculationService';
import { buildFundingEmbed } from '../renderer/embedBuilder';
import type { EmbedConfigInput } from '../types/funding';

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    const cfg = getGuildConfig(interaction.guildId);
    if (!cfg || !cfg.enabled) {
      await interaction.editReply('Funding tracker is not configured for this server.');
      return;
    }

    const now = new Date();
    const monthKey = getCurrentMonthKey(now);
    const totalFunded = getMonthTotal(interaction.guildId, monthKey);

    const state = computeFundingState({
      totalFunded,
      hourlyCost: cfg.hourlyCost,
      nowUtc: now,
    });

    const embedConfig: EmbedConfigInput = {
      displayTitle: cfg.displayTitle,
      updatedAt: cfg.updatedAt,
      publicDisplayMode: cfg.publicDisplayMode,
    };

    const embed = buildFundingEmbed(embedConfig, state);

    // Admin-only extras: financial details not shown publicly.
    const isAdmin =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    if (isAdmin) {
      const records = getMonthRecords(interaction.guildId, monthKey);
      embed.addFields(
        { name: 'Total Funded', value: `$${totalFunded.toFixed(2)}`, inline: true },
        { name: 'Hourly Cost', value: `$${cfg.hourlyCost}/hr`, inline: true },
        { name: 'Records This Month', value: String(records.length), inline: true },
      );
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[status] Error during /funding status:', err);
    await interaction
      .editReply('Something went wrong. Please try again or contact the bot admin.')
      .catch(() => {});
  }
}
