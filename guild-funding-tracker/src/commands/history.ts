// /funding history — view archived monthly funding summaries.
// Reads from month_archive only. Does not recompute from donation records.

import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  getMonthArchive,
  getRecentArchives,
  type MonthArchiveRow,
} from '../services/archiveService';

const HISTORY_LIMIT = 3;

export async function handleHistory(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    const monthOption = interaction.options.getString('month');

    if (monthOption !== null) {
      const row = getMonthArchive(interaction.guildId, monthOption);
      if (!row) {
        await interaction.editReply(
          `No archive found for month **${monthOption}**. ` +
            `Use \`/funding reset-month\` to create one manually.`,
        );
        return;
      }
      await interaction.editReply({ embeds: [buildArchiveEmbed(row)] });
    } else {
      const rows = getRecentArchives(interaction.guildId, HISTORY_LIMIT);
      if (rows.length === 0) {
        await interaction.editReply(
          'No archived months found for this server. ' +
            'Archives are created automatically at the start of each month.',
        );
        return;
      }
      await interaction.editReply({ embeds: rows.map(buildArchiveEmbed) });
    }
  } catch (err) {
    console.error('[history] Unhandled error:', err);
    await interaction
      .editReply('Something went wrong. Please try again or contact the bot admin.')
      .catch(() => {});
  }
}

function buildArchiveEmbed(row: MonthArchiveRow): EmbedBuilder {
  const coverage = formatPercentage(row.percentageFunded);
  const finalizedTimestamp = Math.floor(new Date(row.finalizedAt).getTime() / 1000);

  return new EmbedBuilder()
    .setTitle(`Archive — ${row.monthKey}`)
    .setColor(
      row.percentageFunded >= 75 ? 0x57f287 :
      row.percentageFunded >= 25 ? 0xfee75c :
      0xed4245,
    )
    .addFields(
      { name: 'Monthly Coverage', value: coverage, inline: true },
      {
        name: 'Funded Hours',
        value: `${row.fundedHours.toFixed(1)}h / ${row.monthHours.toFixed(1)}h`,
        inline: true,
      },
      { name: 'Total Funded', value: `$${row.totalFunded.toFixed(2)}`, inline: true },
      { name: 'Finalized', value: `<t:${finalizedTimestamp}:D>`, inline: true },
    );
}

function formatPercentage(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded % 1 === 0 ? `${Math.round(rounded)}%` : `${rounded.toFixed(1)}%`;
}
