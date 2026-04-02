CREATE TABLE "connector" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"encrypted_config" text NOT NULL,
	"encryption_iv" text NOT NULL,
	"encryption_auth_tag" text NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_duration_ms" integer,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connector_provider_check" CHECK ("provider" IN ('posthog', 'stripe')),
	CONSTRAINT "connector_status_check" CHECK ("status" IN ('pending', 'connected', 'error', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE "sync_job" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sync_job_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "sync_job_trigger_check" CHECK ("trigger" IN ('initial', 'manual', 'scheduled'))
);
--> statement-breakpoint
ALTER TABLE "connector" ADD CONSTRAINT "connector_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_job" ADD CONSTRAINT "sync_job_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "connector_startup_provider_uidx" ON "connector" USING btree ("startup_id", "provider");
--> statement-breakpoint
CREATE INDEX "connector_startupId_idx" ON "connector" USING btree ("startup_id");
--> statement-breakpoint
CREATE INDEX "connector_status_idx" ON "connector" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "sync_job_connectorId_idx" ON "sync_job" USING btree ("connector_id");
--> statement-breakpoint
CREATE INDEX "sync_job_status_idx" ON "sync_job" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "sync_job_createdAt_idx" ON "sync_job" USING btree ("created_at");
