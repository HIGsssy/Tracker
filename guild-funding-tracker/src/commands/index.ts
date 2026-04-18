// Command routing table. Maps "commandName:subcommand" to handler functions.
// Phase 3: setup. Phase 4: add, remove, status. Phase 5: set-hourly-cost, config, refresh.

import type { ChatInputCommandInteraction } from 'discord.js';
import { handleSetup } from './setup';
import { handleAdd } from './add';
import { handleRemove } from './remove';
import { handleStatus } from './status';
import { handleSetHourlyCost } from './setHourlyCost';
import { handleConfig } from './config';
import { handleRefresh } from './refresh';

type CommandHandler = (interaction: ChatInputCommandInteraction) => Promise<void>;

const handlers: Record<string, CommandHandler> = {
  'funding:setup': handleSetup,
  'funding:add': handleAdd,
  'funding:remove': handleRemove,
  'funding:status': handleStatus,
  'funding:set-hourly-cost': handleSetHourlyCost,
  'funding:config': handleConfig,
  'funding:refresh': handleRefresh,
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
