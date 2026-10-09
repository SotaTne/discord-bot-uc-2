ALTER TABLE `guild_settings` ADD `recruit_mention_mode` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_settings` ADD `recruit_mention_targets` text DEFAULT '[]' NOT NULL;