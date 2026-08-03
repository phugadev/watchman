ALTER TABLE `monitors` ADD `dns_record_type` text;--> statement-breakpoint
ALTER TABLE `monitors` ADD `dns_expected` text;--> statement-breakpoint
ALTER TABLE `monitors` ADD `dns_match_mode` text DEFAULT 'contains' NOT NULL;--> statement-breakpoint
ALTER TABLE `monitors` ADD `dns_resolver` text;