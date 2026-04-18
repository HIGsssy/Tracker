// Entry point: validate env → migrate DB → connect Discord
import path from 'path';
import { REST, Routes } from 'discord.js';
import { config } from './config/env';
import { db } from './db/client';
import { createDiscordClient } from './bot/client';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { handleInteractionCreate } from './bot/events/interactionCreate';
import { handleReady } from './bot/events/ready';
import { startMonthlyResetScheduler } from './scheduler/monthlyReset';
import { fundingCommand } from './bot/commandsDefinition';

/**
 * Registers slash commands for the configured dev guild.
 * Only called when DISCORD_DEV_GUILD_ID is set.
 * Uses the REST API directly — does not require the Discord client to be logged in.
 */
async function registerDevGuildCommands(): Promise<void> {
  const guildId = config.DISCORD_DEV_GUILD_ID!;
  console.log(`[startup] Auto-registering commands for dev guild ${guildId}…`);
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId),
    { body: [fundingCommand.toJSON()] },
  );
  console.log(`[startup] Commands registered for guild ${guildId}.`);
}

async function bootstrap(): Promise<void> {
  // Env validation happens at import time in config/env.ts — a hard exit there prevents reaching here
  console.log(`[startup] Environment validated. NODE_ENV=${config.NODE_ENV} LOG_LEVEL=${config.LOG_LEVEL}`);

  // Run migrations (drizzle migrator is idempotent — safe on every boot)
  const migrationsFolder = path.join(__dirname, 'db', 'migrations');
  try {
    migrate(db, { migrationsFolder });
    console.log('[startup] Database migrations applied.');
  } catch (err) {
    console.error('[startup] Database migration failed:', err);
    process.exit(1);
  }

  // Optional: auto-register slash commands for a dev guild before login.
  // Requires only the REST API — safe to run before the Discord client connects.
  if (config.DISCORD_DEV_GUILD_ID) {
    try {
      await registerDevGuildCommands();
    } catch (err) {
      console.error('[startup] Command auto-registration failed:', err);
      process.exit(1);
    }
  } else {
    console.log('[startup] DISCORD_DEV_GUILD_ID not set — skipping command auto-registration.');
  }

  // Create Discord client
  const client = createDiscordClient();

  client.once('ready', (c) => {
    handleReady(c).catch((err) => {
      console.error('[ready] Unhandled error during startup validation:', err);
    });
  });

  client.on('interactionCreate', (interaction) => {
    handleInteractionCreate(interaction).catch((err) => {
      console.error('[interactionCreate] Unhandled error:', err);
    });
  });

  // Graceful shutdown on container stop signals
  const shutdown = (): void => {
    console.log('[shutdown] Signal received, disconnecting.');
    client.destroy();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // Log in with token — exits non-zero on failure
  console.log('[startup] Discord login starting.');
  try {
    await client.login(config.DISCORD_TOKEN);
  } catch (err) {
    console.error('[startup] Discord login failed:', err);
    process.exit(1);
  }

  // Start the monthly archive scheduler after successful login (self-rescheduling setTimeout — no polling)
  startMonthlyResetScheduler(client);
  console.log('[startup] Monthly reset scheduler started.');
}

bootstrap().catch((err) => {
  console.error('[startup] Fatal error during startup:', err);
  process.exit(1);
});
