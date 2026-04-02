CREATE TABLE "internal_task" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"source_insight_id" text NOT NULL,
	"source_action_index" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"linked_metric_keys" jsonb NOT NULL,
	"sync_status" text DEFAULT 'not_synced' NOT NULL,
	"linear_issue_id" text,
	"last_sync_error" text,
	"last_sync_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "internal_task" ADD CONSTRAINT "internal_task_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "internal_task_startup_insight_action_uidx" ON "internal_task" USING btree ("startup_id", "source_insight_id", "source_action_index");
--> statement-breakpoint
CREATE INDEX "internal_task_startupId_idx" ON "internal_task" USING btree ("startup_id");
--> statement-breakpoint
CREATE INDEX "internal_task_syncStatus_idx" ON "internal_task" USING btree ("sync_status");
--> statement-breakpoint
CREATE INDEX "internal_task_createdAt_idx" ON "internal_task" USING btree ("created_at");
