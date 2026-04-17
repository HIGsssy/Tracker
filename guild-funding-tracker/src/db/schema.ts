import { sqliteTable, text, integer, real, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Discord snowflakes exceed SQLite integer precision — all snowflake columns use TEXT.

export const guildTrackerConfig = sqliteTable(
  'guild_tracker_config',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull().unique(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    trackerChannelId: text('tracker_channel_id'),   // NULL until /funding setup
    trackerMessageId: text('tracker_message_id'),   // NULL until first embed post
    // CHECK constraint mirrors MIN_HOURLY_COST / MAX_HOURLY_COST in constants/validation.ts
    hourlyCost: real('hourly_cost').notNull().default(0.06),
    displayTitle: text('display_title').notNull().default('Server Funding'),
    publicDisplayMode: text('public_display_mode', { enum: ['standard', 'minimal'] })
      .notNull()
      .default('standard'),
    // Always 1 in v1; field exists so a future migration can make it configurable
    hidePublicDollarValues: integer('hide_public_dollar_values', { mode: 'boolean' })
      .notNull()
      .default(true),
    adminRoleId: text('admin_role_id'),
    createdAt: text('created_at').notNull(),   // ISO8601 UTC
    updatedAt: text('updated_at').notNull(),   // ISO8601 UTC; refreshed on every embed update
  },
  (table) => ({
    hourlyCostBounds: check(
      'hourly_cost_bounds',
      sql`${table.hourlyCost} >= 0.001 AND ${table.hourlyCost} <= 1000.0`,
    ),
  }),
);

export const donationRecord = sqliteTable(
  'donation_record',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    monthKey: text('month_key').notNull(),           // YYYY-MM; set explicitly at insert, not derived
    amount: real('amount').notNull(),
    recordedAt: text('recorded_at').notNull(),       // ISO8601 UTC; wall-clock time of data entry
    donorName: text('donor_name'),
    note: text('note'),
    createdByUserId: text('created_by_user_id').notNull(),  // Discord user snowflake
  },
  (table) => ({
    guildMonthIdx: index('idx_donation_guild_month').on(table.guildId, table.monthKey),
    amountPositive: check('amount_positive', sql`${table.amount} > 0`),
  }),
);

export const monthArchive = sqliteTable(
  'month_archive',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    monthKey: text('month_key').notNull(),               // YYYY-MM
    totalFunded: real('total_funded').notNull(),
    hourlyCostSnapshot: real('hourly_cost_snapshot').notNull(),  // cost at time of archive
    fundedHours: real('funded_hours').notNull(),
    monthHours: real('month_hours').notNull(),
    percentageFunded: real('percentage_funded').notNull(),       // final monthly_coverage %, capped at 100
    finalizedAt: text('finalized_at').notNull(),         // ISO8601 UTC
  },
  (table) => ({
    // UNIQUE makes archiving idempotent — safe to run multiple times for the same guild+month
    guildMonthUnique: uniqueIndex('month_archive_guild_id_month_key_unique').on(
      table.guildId,
      table.monthKey,
    ),
  }),
);
