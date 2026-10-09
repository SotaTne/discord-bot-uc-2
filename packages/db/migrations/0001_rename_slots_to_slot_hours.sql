ALTER TABLE `slots` RENAME TO `slot_hours`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_slot_hours` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`hour` integer NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "slot_hours_hour_range" CHECK("__new_slot_hours"."hour" BETWEEN 0 AND 23)
);
--> statement-breakpoint
INSERT INTO `__new_slot_hours`("id", "guild_id", "hour", "created_at", "deleted_at") SELECT "id", "guild_id", "hour", "created_at", "deleted_at" FROM `slot_hours`;--> statement-breakpoint
DROP TABLE `slot_hours`;--> statement-breakpoint
ALTER TABLE `__new_slot_hours` RENAME TO `slot_hours`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `slot_hours_guild_hour` ON `slot_hours` (`guild_id`,`hour`);