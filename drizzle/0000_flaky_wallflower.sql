CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`notify_on_recovery` integer DEFAULT true NOT NULL,
	`notify_on_degraded` integer DEFAULT false NOT NULL,
	`last_used_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checks` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`at` integer NOT NULL,
	`ok` integer NOT NULL,
	`status` text NOT NULL,
	`latency_ms` integer,
	`http_status` integer,
	`error` text,
	`meta` text,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checks_monitor_at_idx` ON `checks` (`monitor_id`,`at`);--> statement-breakpoint
CREATE TABLE `incident_events` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`message` text,
	`actor_id` text,
	`meta` text,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `incident_events_incident_idx` ON `incident_events` (`incident_id`,`at`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`severity` text DEFAULT 'down' NOT NULL,
	`started_at` integer NOT NULL,
	`resolved_at` integer,
	`cause` text,
	`failed_checks` integer DEFAULT 1 NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	`flapping` integer DEFAULT false NOT NULL,
	`suppressed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `incidents_monitor_idx` ON `incidents` (`monitor_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `incidents_status_idx` ON `incidents` (`status`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`role` text DEFAULT 'member' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `maintenance_monitors` (
	`window_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	PRIMARY KEY(`window_id`, `monitor_id`),
	FOREIGN KEY (`window_id`) REFERENCES `maintenance_windows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maintenance_monitors_monitor_idx` ON `maintenance_monitors` (`monitor_id`);--> statement-breakpoint
CREATE TABLE `maintenance_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`suppress_alerts` integer DEFAULT true NOT NULL,
	`pause_checks` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `maintenance_window_range_idx` ON `maintenance_windows` (`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `monitor_channels` (
	`monitor_id` text NOT NULL,
	`channel_id` text NOT NULL,
	PRIMARY KEY(`monitor_id`, `channel_id`),
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `monitor_channels_channel_idx` ON `monitor_channels` (`channel_id`);--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`method` text DEFAULT 'GET' NOT NULL,
	`headers` text,
	`body` text,
	`expected_status` text DEFAULT '2xx' NOT NULL,
	`keyword` text,
	`keyword_mode` text DEFAULT 'contains' NOT NULL,
	`follow_redirects` integer DEFAULT true NOT NULL,
	`verify_tls` integer DEFAULT true NOT NULL,
	`interval_sec` integer DEFAULT 60 NOT NULL,
	`timeout_ms` integer DEFAULT 10000 NOT NULL,
	`confirm_failures` integer DEFAULT 2 NOT NULL,
	`confirm_recoveries` integer DEFAULT 2 NOT NULL,
	`degraded_ms` integer,
	`heartbeat_token` text,
	`grace_sec` integer DEFAULT 120 NOT NULL,
	`ssl_warn_days` integer DEFAULT 21 NOT NULL,
	`slo_target_pct` real DEFAULT 99.9 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`last_status` text DEFAULT 'pending' NOT NULL,
	`last_checked_at` integer,
	`last_latency_ms` integer,
	`last_error` text,
	`last_status_changed_at` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`consecutive_successes` integer DEFAULT 0 NOT NULL,
	`next_run_at` integer,
	`tags` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monitors_heartbeat_token_unique` ON `monitors` (`heartbeat_token`);--> statement-breakpoint
CREATE INDEX `monitors_next_run_idx` ON `monitors` (`next_run_at`);--> statement-breakpoint
CREATE INDEX `monitors_paused_idx` ON `monitors` (`paused`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`monitor_id` text,
	`incident_id` text,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	`ok` integer NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`status_code` integer,
	`duration_ms` integer,
	`error` text,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_incident_idx` ON `notifications` (`incident_id`);--> statement-breakpoint
CREATE INDEX `notifications_at_idx` ON `notifications` (`at`);--> statement-breakpoint
CREATE TABLE `rollups` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`bucket` text NOT NULL,
	`started_at` integer NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`up_count` integer DEFAULT 0 NOT NULL,
	`degraded_count` integer DEFAULT 0 NOT NULL,
	`down_count` integer DEFAULT 0 NOT NULL,
	`avg_ms` real,
	`p50_ms` integer,
	`p95_ms` integer,
	`p99_ms` integer,
	`min_ms` integer,
	`max_ms` integer,
	`downtime_ms` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rollups_key_unique` ON `rollups` (`monitor_id`,`bucket`,`started_at`);--> statement-breakpoint
CREATE INDEX `rollups_lookup_idx` ON `rollups` (`monitor_id`,`bucket`,`started_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `status_page_items` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`display_name` text,
	`group_name` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `status_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `status_page_items_unique` ON `status_page_items` (`page_id`,`monitor_id`);--> statement-breakpoint
CREATE INDEX `status_page_items_page_idx` ON `status_page_items` (`page_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `status_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`published` integer DEFAULT false NOT NULL,
	`show_grades` integer DEFAULT true NOT NULL,
	`show_latency` integer DEFAULT true NOT NULL,
	`history_days` integer DEFAULT 90 NOT NULL,
	`contact_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `status_pages_slug_unique` ON `status_pages` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);