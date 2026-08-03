CREATE TABLE `escalation_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repeat_sec` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `escalation_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_id` text NOT NULL,
	`position` integer NOT NULL,
	`after_sec` integer NOT NULL,
	`channel_id` text NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `escalation_policies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `escalation_steps_policy_idx` ON `escalation_steps` (`policy_id`,`position`);--> statement-breakpoint
CREATE INDEX `escalation_steps_channel_idx` ON `escalation_steps` (`channel_id`);--> statement-breakpoint
ALTER TABLE `incidents` ADD `escalation_level` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `monitors` ADD `escalation_policy_id` text REFERENCES escalation_policies(id);