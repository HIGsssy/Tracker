// /funding remove — removes a specific donation record, with button confirmation.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getDonationRecord, removeDonation, ValidationError } from '../services/fundingService';
import { refreshTracker, TrackerError } from '../services/trackerService';

const CONFIRM_ID = 'confirm_remove';
const CANCEL_ID = 'cancel_remove';
const CONFIRM_TIMEOUT_MS = 30_000;

export async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
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

    const recordId = interaction.options.getInteger('record_id', true);

    // Verify the record exists and belongs to this guild before showing confirmation.
    const record = getDonationRecord(interaction.guildId, recordId);
    if (!record) {
      await interaction.editReply(`Record #${recordId} not found for this server.`);
      return;
    }

    const donorLabel = record.donorName ? ` — ${record.donorName}` : '';
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CONFIRM_ID)
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(CANCEL_ID)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      content:
        `Remove record #${recordId} ($${record.amount.toFixed(2)}${donorLabel})? ` +
        `This cannot be undone.`,
      components: [confirmRow],
    });

    const msg = await interaction.fetchReply();

    let btnInteraction;
    try {
      btnInteraction = await msg.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: CONFIRM_TIMEOUT_MS,
      });
    } catch {
      // Collector timed out — no button was clicked within the window.
      await interaction
        .editReply({ content: 'Confirmation timed out. No changes made.', components: [] })
        .catch(() => {});
      return;
    }

    if (btnInteraction.customId === CONFIRM_ID) {
      const removed = removeDonation(interaction.guildId, recordId);
      if (!removed) {
        // Record disappeared between verification and confirmation (race condition).
        await btnInteraction
          .update({
            content: `Record #${recordId} not found (may have already been removed).`,
            components: [],
          })
          .catch(() => {});
        return;
      }

      await refreshTracker(interaction.guildId, interaction.client);

      await btnInteraction
        .update({ content: `Record #${recordId} removed. Tracker updated.`, components: [] })
        .catch(() => {});
    } else {
      await btnInteraction
        .update({ content: 'Deletion cancelled.', components: [] })
        .catch(() => {});
    }
  } catch (err) {
    console.error('[remove] Error during /funding remove:', err);
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
