CREATE TABLE `dashboard_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`guild_id` text NOT NULL,
	`issued_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_links_token_hash_unique` ON `dashboard_links` (`token_hash`);--> statement-breakpoint
CREATE TABLE `guild_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`channel_id` text,
	`recruit_hour` integer DEFAULT 12 NOT NULL,
	`cutoff_minutes` integer DEFAULT 7 NOT NULL,
	`fixed_after_matches` integer DEFAULT 5 NOT NULL,
	`fixed_points` integer DEFAULT 100 NOT NULL,
	`revoke_sessions_on_reissue` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `handups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`match_slot_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`raised_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`match_slot_id`) REFERENCES `match_slots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handups_unique` ON `handups` (`match_slot_id`,`team_id`);--> statement-breakpoint
CREATE INDEX `handups_match_slot` ON `handups` (`match_slot_id`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`job_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_runs_unique` ON `job_runs` (`guild_id`,`job_key`);--> statement-breakpoint
CREATE TABLE `match_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`slot_date` text NOT NULL,
	`slot_hour` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`matched_at` integer,
	`excluded_team_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`excluded_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "match_slots_hour_range" CHECK("match_slots"."slot_hour" BETWEEN 0 AND 23),
	CONSTRAINT "match_slots_status_shape" CHECK(("match_slots"."status" = 'open' AND "match_slots"."matched_at" IS NULL AND "match_slots"."excluded_team_id" IS NULL) OR ("match_slots"."status" = 'matched' AND "match_slots"."matched_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_slots_slot` ON `match_slots` (`guild_id`,`slot_date`,`slot_hour`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_slot_id` integer NOT NULL,
	`team_a_id` integer NOT NULL,
	`team_b_id` integer NOT NULL,
	FOREIGN KEY (`match_slot_id`) REFERENCES `match_slots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_a_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_b_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "matches_distinct_teams" CHECK("matches"."team_a_id" <> "matches"."team_b_id")
);
--> statement-breakpoint
CREATE INDEX `matches_match_slot` ON `matches` (`match_slot_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_hash` text NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_session_hash_unique` ON `sessions` (`session_hash`);--> statement-breakpoint
CREATE TABLE `slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`hour` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "slots_hour_range" CHECK("slots"."hour" BETWEEN 0 AND 23)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slots_guild_hour` ON `slots` (`guild_id`,`hour`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`role_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_guild_role` ON `teams` (`guild_id`,`role_id`);--> statement-breakpoint
CREATE TABLE `wins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`match_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`points` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`screenshot_key` text,
	`recorded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wins_guild` ON `wins` (`guild_id`,`id`);--> statement-breakpoint
CREATE INDEX `wins_match` ON `wins` (`match_id`);