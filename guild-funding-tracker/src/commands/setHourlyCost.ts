// /funding set-hourly-cost — updates the per-guild hourly cost and refreshes the tracker.

import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { upsertGuildConfig, ValidationError } from '../services/fundingService';
import { refreshTracker, TrackerError } from '../services/trackerService';
import { MIN_HOURLY_COST, MAX_HOURLY_COST } from '../constants/validation';

export async function handleSetHourlyCost(interaction: ChatInputCommandInteraction): Promise<void> {
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

    const cost = interaction.options.getNumber('cost', true);

    // Defense-in-depth: Discord enforces min/max via setMinValue/setMaxValue, but we validate here too.
    if (!Number.isFinite(cost) || cost < MIN_HOURLY_COST || cost > MAX_HOURLY_COST) {
      await interaction.editReply(
        `Hourly cost must be between $${MIN_HOURLY_COST} and $${MAX_HOURLY_COST}.`,
      );
      return;
    }

    upsertGuildConfig(interaction.guildId, { hourlyCost: cost });
    await refreshTracker(interaction.guildId, interaction.client);

    // Format cost: strip trailing decimal zeros for clean display.
    const formattedCost = cost.toFixed(4).replace(/\.?0+$/, '');
    await interaction.editReply(`Hourly cost updated to $${formattedCost}/hr. Tracker recalculated.`);
  } catch (err) {
    if (err instanceof ValidationError) {
      await interaction.editReply(err.message).catch(() => {});
      return;
    }
    if (err instanceof TrackerError) {
      await interaction.editReply(`Tracker error: ${err.message}`).catch(() => {});
      return;
    }
    console.error('[set-hourly-cost] Unhandled error:', err);
    await interaction
      .editReply('Something went wrong. Please try again or contact the bot admin.')
      .catch(() => {});
  }
}
