import { z } from 'zod';
import dotenv from 'dotenv';
import {
  MIN_HOURLY_COST,
  MAX_HOURLY_COST,
  STALE_EMBED_DEFAULT_THRESHOLD_HOURS,
} from '../constants/validation';

dotenv.config();

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),

  DATABASE_PATH: z.string().default('/data/tracker.db'),

  DEFAULT_HOURLY_COST: z.coerce
    .number()
    .min(MIN_HOURLY_COST, `DEFAULT_HOURLY_COST must be >= ${MIN_HOURLY_COST}`)
    .max(MAX_HOURLY_COST, `DEFAULT_HOURLY_COST must be <= ${MAX_HOURLY_COST}`)
    .default(0.06),

  STALE_EMBED_THRESHOLD_HOURS: z.coerce
    .number()
    .gt(0, 'STALE_EMBED_THRESHOLD_HOURS must be > 0')
    .default(STALE_EMBED_DEFAULT_THRESHOLD_HOURS),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('[config] Invalid environment configuration:');
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = result.data;
export type AppConfig = typeof config;
