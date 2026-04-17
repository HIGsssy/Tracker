// Command routing table. Maps "commandName:subcommand" to handler functions.
// Only Phase 3 commands are registered here.

import type { ChatInputCommandInteraction } from 'discord.js';
import { handleSetup } from './setup';

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

const handlers: Record<string, CommandHandler> = {
  'funding:setup': handleSetup,
};

/**
 * Returns the handler for the given command + subcommand pair, or null if unknown.
 * Key format: "commandName:subcommand" (or just "commandName" for top-level commands).
 */
export function getCommandHandler(
  commandName: string,
  subcommand: string | null,
): CommandHandler | null {
  const key = subcommand != null ? `${commandName}:${subcommand}` : commandName;
  return handlers[key] ?? null;
}
