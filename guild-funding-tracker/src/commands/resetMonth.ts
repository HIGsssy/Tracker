// /funding reset-month — manually archive a past month's funding state.
// Idempotent: archive uses upsert semantics, safe to run multiple times.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getPreviousMonthKey } from '../services/calculationService';
import { archiveMonth, ArchiveError } from '../services/archiveService';
import { getGuildConfig } from '../services/fundingService';
import { refreshTracker, TrackerError } from '../services/trackerService';

const CONFIRM_ID = 'confirm_reset_month';
const CANCEL_ID = 'cancel_reset_month';
const CONFIRM_TIMEOUT_MS = 30_000;

/** Returns true if the string is a valid YYYY-MM month key. */
function isValidMonthKey(value: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
}

export async function handleResetMonth(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  // Hoisted outside the try block so the error handler can acknowledge the button if already received.
  let buttonInteraction: ButtonInteraction | undefined;

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

    const monthOption = interaction.options.getString('month');
    let monthKey: string;

    if (monthOption !== null) {
      if (!isValidMonthKey(monthOption)) {
        await interaction.editReply(
          'Invalid month format. Please use YYYY-MM (e.g. 2026-03).',
        );
        return;
      }
      monthKey = monthOption;
    } else {
      monthKey = getPreviousMonthKey(new Date());
    }

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
        `Archive month **${monthKey}** for this server? ` +
        `This is a snapshot — donation records are not modified. ` +
        `This can be run multiple times safely.`,
      components: [confirmRow],
    });

    try {
      buttonInteraction = await interaction.fetchReply().then((msg) =>
        msg.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) => i.user.id === interaction.user.id,
          time: CONFIRM_TIMEOUT_MS,
        }),
      );
    } catch {
      await interaction.editReply({ content: 'Archive cancelled (timed out).', components: [] });
      return;
    }

    // The catch block above always returns, so buttonInteraction is defined here.
    // This guard is unreachable at runtime but allows TypeScript to narrow the type.
    if (buttonInteraction === undefined) return;

    if (buttonInteraction.customId === CANCEL_ID) {
      await buttonInteraction.update({ content: 'Archive cancelled.', components: [] });
      return;
    }

    // Confirmed — archive the month (synchronous DB write, idempotent).
    archiveMonth(interaction.guildId, monthKey);

    // Refresh the tracker embed. If the tracker is not configured, archive still succeeded.
    const cfg = getGuildConfig(interaction.guildId);
    let refreshNote = '';
    if (cfg?.trackerChannelId) {
      try {
        await refreshTracker(interaction.guildId, interaction.client);
      } catch (refreshErr) {
        if (refreshErr instanceof TrackerError) {
          refreshNote = ` Note: ${refreshErr.message}`;
        } else {
          refreshNote = ' Note: Tracker refresh failed.';
        }
      }
    }

    await buttonInteraction.update({
      content: `Month **${monthKey}** archived successfully.${refreshNote}`,
      components: [],
    });
  } catch (err) {
    if (err instanceof ArchiveError) {
      if (buttonInteraction) {
        await buttonInteraction
          .update({ content: `Archive error: ${err.message}`, components: [] })
          .catch(() => {});
      } else {
        await interaction.editReply(`Archive error: ${err.message}`).catch(() => {});
      }
      return;
    }
    console.error('[reset-month] Unhandled error:', err);
    await interaction
      .editReply('Something went wrong. Please try again or contact the bot admin.')
      .catch(() => {});
  }
}
