// Routes Discord interactions to command handlers.
// Only ChatInputCommand interactions are processed; all others are ignored.

import type { Interaction } from 'discord.js';
import { getCommandHandler } from '../../commands/index';

export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  // Returns null when the command has no subcommand (top-level only).
  const subcommand = interaction.options.getSubcommand(false);
  const handler = getCommandHandler(interaction.commandName, subcommand);

  if (!handler) {
    // Unknown command — respond safely to avoid "This interaction failed".
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Unknown command.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  await handler(interaction).catch((err) => {
    console.error(
      `[interactionCreate] Unhandled error in handler for ` +
      `"${interaction.commandName}${subcommand ? ':' + subcommand : ''}":`,
      err,
    );
  });
}
