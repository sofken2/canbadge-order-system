ALTER TABLE `order_items` ADD `kira_pattern` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `kira_shards_stock` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `kira_aurora_stock` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
-- いまの在庫は、2 つの柄に、同じ値で引き継ぐ。柄を記録していなかった、キラフィルムつきの注文は、割れガラスとして数える
UPDATE `settings` SET `kira_shards_stock` = `kira_film_stock`, `kira_aurora_stock` = `kira_film_stock`;--> statement-breakpoint
UPDATE `order_items` SET `kira_pattern` = 'shards' WHERE `kira_quantity` > 0;
