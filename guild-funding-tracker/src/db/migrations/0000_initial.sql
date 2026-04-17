CREATE TABLE `guild_tracker_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`tracker_channel_id` text,
	`tracker_message_id` text,
	`hourly_cost` real DEFAULT 0.06 NOT NULL,
	`display_title` text DEFAULT 'Server Funding' NOT NULL,
	`public_display_mode` text DEFAULT 'standard' NOT NULL,
	`hide_public_dollar_values` integer DEFAULT 1 NOT NULL,
	`admin_role_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `hourly_cost_bounds` CHECK(`hourly_cost` >= 0.001 AND `hourly_cost` <= 1000.0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guild_tracker_config_guild_id_unique` ON `guild_tracker_config` (`guild_id`);
--> statement-breakpoint
CREATE TABLE `donation_record` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`month_key` text NOT NULL,
	`amount` real NOT NULL,
	`recorded_at` text NOT NULL,
	`donor_name` text,
	`note` text,
	`created_by_user_id` text NOT NULL,
	CONSTRAINT `amount_positive` CHECK(`amount` > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_donation_guild_month` ON `donation_record` (`guild_id`, `month_key`);
--> statement-breakpoint
CREATE TABLE `month_archive` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`month_key` text NOT NULL,
	`total_funded` real NOT NULL,
	`hourly_cost_snapshot` real NOT NULL,
	`funded_hours` real NOT NULL,
	`month_hours` real NOT NULL,
	`percentage_funded` real NOT NULL,
	`finalized_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `month_archive_guild_id_month_key_unique` ON `month_archive` (`guild_id`, `month_key`);
