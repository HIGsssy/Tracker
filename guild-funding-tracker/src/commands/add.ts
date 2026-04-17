// /funding add — records a funding contribution for the current month.

import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { addDonation, ValidationError } from '../services/fundingService';
import { refreshTracker, TrackerError } from '../services/trackerService';

export async function handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
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

    const amount = interaction.options.getNumber('amount', true);
    const donorName = interaction.options.getString('donor_name') ?? undefined;
    const note = interaction.options.getString('note') ?? undefined;

    const record = addDonation(interaction.guildId, amount, interaction.user.id, donorName, note);

    await refreshTracker(interaction.guildId, interaction.client);

    await interaction.editReply(
      `Added $${record.amount.toFixed(2)} to ${record.monthKey} funding. Tracker updated.`,
    );
  } catch (err) {
    console.error('[add] Error during /funding add:', err);
    if (err instanceof ValidationError) {
      await interaction.editReply(err.message).catch(() => {});
    } else if (err instanceof TrackerError) {
      await interaction.editReply(err.message).catch(() => {});
    } else {
      await interaction.editReply(
        'Something went wrong. Please try again or contact the bot admin.',
      ).catch(() => {});
    }
  }
}
