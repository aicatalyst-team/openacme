-- Usage ledger: one row per LLM call. Trimmed from the generated diff:
-- drizzle-kit diffed against 0006 (snapshots for the hand-written
-- 0007-0009 were never committed) and re-emitted their statements;
-- only the usage_events DDL below is new. 0010_snapshot.json captures
-- the full current schema, so future generates diff cleanly again.
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`agent_id` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text,
	`task_id` text,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`auth_mode` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer,
	`reasoning_tokens` integer,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`cost_usd_equivalent` real,
	`cost_source` text NOT NULL,
	`steps` integer,
	`duration_ms` integer
);
--> statement-breakpoint
CREATE INDEX `idx_usage_created` ON `usage_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_agent_created` ON `usage_events` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_session` ON `usage_events` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_task` ON `usage_events` (`task_id`);
