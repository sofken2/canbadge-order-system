CREATE TABLE `archive_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text NOT NULL,
	`consent` text NOT NULL,
	`author_anon_token` text NOT NULL,
	`created_at` text NOT NULL,
	`reviewed_at` text,
	FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `archive_entries_status` ON `archive_entries` (`status`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_logs_id_unique` ON `audit_logs` (`id`);--> statement-breakpoint
CREATE TABLE `designs` (
	`id` text PRIMARY KEY NOT NULL,
	`image_path` text NOT NULL,
	`editor_data` text NOT NULL,
	`source_archive_entry_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`design_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text NOT NULL,
	`print_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_items_order_id` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_status` ON `order_items` (`status`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`business_date` text NOT NULL,
	`order_number` integer NOT NULL,
	`confirmation_code` text NOT NULL,
	`anon_token` text NOT NULL,
	`status` text NOT NULL,
	`total_amount` integer NOT NULL,
	`created_at` text NOT NULL,
	`paid_at` text,
	`ready_at` text,
	`picked_up_at` text,
	`refunded_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_business_date_number` ON `orders` (`business_date`,`order_number`);--> statement-breakpoint
CREATE INDEX `orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_anon_token` ON `orders` (`anon_token`);--> statement-breakpoint
CREATE TABLE `print_sheets` (
	`id` text PRIMARY KEY NOT NULL,
	`pdf_path` text NOT NULL,
	`status` text NOT NULL,
	`printed_at` text NOT NULL,
	`checked_at` text
);
--> statement-breakpoint
CREATE TABLE `print_slots` (
	`sheet_id` text NOT NULL,
	`position` integer NOT NULL,
	`order_item_id` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`sheet_id`, `position`),
	FOREIGN KEY (`sheet_id`) REFERENCES `print_sheets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `print_slots_order_item_id` ON `print_slots` (`order_item_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`archive_entry_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`archive_entry_id`) REFERENCES `archive_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`business_date` text,
	`acceptance` text NOT NULL,
	`busy_message` text,
	`price` integer NOT NULL,
	`max_quantity_per_order` integer NOT NULL,
	`max_pending_per_device` integer NOT NULL,
	`print_max_wait_seconds` integer NOT NULL,
	`print_paused` integer NOT NULL,
	`order_number_digits` integer NOT NULL,
	`image_max_bytes` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_singleton" CHECK("settings"."id" = 1)
);
