// Entry point: validate env → migrate DB → connect Discord
import path from 'path';
import { config } from './config/env';
import { db } from './db/client';
import { createDiscordClient } from './bot/client';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { handleInteractionCreate } from './bot/events/interactionCreate';
import { handleReady } from './bot/events/ready';

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
  try {
    await client.login(config.DISCORD_TOKEN);
  } catch (err) {
    console.error('[startup] Discord login failed:', err);
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  console.error('[startup] Fatal error during startup:', err);
  process.exit(1);
});
