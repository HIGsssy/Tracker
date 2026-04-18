// Slash command registration script. Run once per guild or globally.
//
// Usage:
//   npx tsx src/bot/deploy-commands.ts --guild-id=<GUILD_ID>   # instant
//   npx tsx src/bot/deploy-commands.ts --global                 # up to 1 hour propagation
//
// Requires DISCORD_TOKEN and DISCORD_CLIENT_ID in env (or .env file).

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { fundingCommand } from './commandsDefinition';

async function main(): Promise<void> {
  const token = process.env['DISCORD_TOKEN'];
  const clientId = process.env['DISCORD_CLIENT_ID'];

  if (!token) throw new Error('DISCORD_TOKEN env var is required');
  if (!clientId) throw new Error('DISCORD_CLIENT_ID env var is required');

  const args = process.argv.slice(2);
  const isGlobal = args.includes('--global');
  const guildIdArg = args.find((a) => a.startsWith('--guild-id='));
  const guildId = guildIdArg?.split('=')[1];

  if (!isGlobal && !guildId) {
    console.error('Usage: deploy-commands.ts --guild-id=<GUILD_ID> | --global');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const body = [fundingCommand.toJSON()];

  if (isGlobal) {
    console.log(`Registering ${body.length} global command(s)…`);
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log('Global commands registered. Propagation may take up to 1 hour.');
  } else {
    console.log(`Registering ${body.length} guild command(s) for guild ${guildId}…`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId!), { body });
    console.log('Guild commands registered instantly.');
  }
}

main().catch((err) => {
  console.error('Failed to deploy commands:', err);
  process.exit(1);
});
