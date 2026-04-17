// /funding setup — creates or updates guild tracker config and posts the first embed.

import { ChannelType, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import type { TextChannel } from 'discord.js';
import { upsertGuildConfig, ValidationError, type UpsertConfigParams } from '../services/fundingService';
import { refreshTracker, TrackerError } from '../services/trackerService';
import { MIN_HOURLY_COST, MAX_HOURLY_COST } from '../constants/validation';

export async function handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    // Require ManageGuild permission.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.editReply(
        'You do not have permission to use this command. (Requires Manage Server)',
      );
      return;
    }

    // Validate channel option — must be a text channel.
    const channelOption = interaction.options.getChannel('channel', true);
    if (
      channelOption.type !== ChannelType.GuildText &&
      channelOption.type !== ChannelType.GuildAnnouncement
    ) {
      await interaction.editReply('The tracker channel must be a text channel.');
      return;
    }

    // Verify the bot has SendMessages + EmbedLinks in that channel.
    const channel = channelOption as TextChannel;
    const botMember = interaction.guild.members.me;
    if (!botMember) {
      await interaction.editReply('Could not verify bot permissions. Please try again.');
      return;
    }
    const perms = channel.permissionsFor(botMember);
    if (!perms?.has(['SendMessages', 'EmbedLinks'])) {
      await interaction.editReply(
        `I don't have permission to send messages or embed links in <#${channel.id}>. ` +
        `Please update my permissions and try again.`,
      );
      return;
    }

    // Validate optional hourly_cost (Discord enforces min/max via setMinValue/setMaxValue,
    // but we validate here too as defense-in-depth).
    const hourlyCostOption = interaction.options.getNumber('hourly_cost');
    if (hourlyCostOption !== null) {
      if (
        !Number.isFinite(hourlyCostOption) ||
        hourlyCostOption < MIN_HOURLY_COST ||
        hourlyCostOption > MAX_HOURLY_COST
      ) {
        await interaction.editReply(
          `Hourly cost must be between $${MIN_HOURLY_COST} and $${MAX_HOURLY_COST}.`,
        );
        return;
      }
    }

    const titleOption = interaction.options.getString('title');

    const partial: UpsertConfigParams = {
      enabled: true,
      trackerChannelId: channel.id,
    };
    if (hourlyCostOption !== null) partial.hourlyCost = hourlyCostOption;
    if (titleOption) partial.displayTitle = titleOption;

    upsertGuildConfig(interaction.guildId, partial);

    // Post or update the tracker embed.
    await refreshTracker(interaction.guildId, interaction.client);

    await interaction.editReply(
      `Tracker set up in <#${channel.id}>. Use \`/funding add\` to record this month's funding.`,
    );
  } catch (err) {
    console.error('[setup] Error during /funding setup:', err);
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
