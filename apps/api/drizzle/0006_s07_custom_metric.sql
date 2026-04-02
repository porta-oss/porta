-- S07: Startup-scoped custom metric definition and read-model.
-- Also widen the connector provider check constraint to allow 'postgres'.

-- Widen the connector provider check to include 'postgres'
ALTER TABLE "connector" DROP CONSTRAINT IF EXISTS "connector_provider_check";
--> statement-breakpoint
ALTER TABLE "connector" ADD CONSTRAINT "connector_provider_check" CHECK ("provider" IN ('posthog', 'stripe', 'postgres'));
--> statement-breakpoint

CREATE TABLE "custom_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"schema" text NOT NULL,
	"view" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"metric_value" numeric,
	"previous_value" numeric,
	"captured_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_metric" ADD CONSTRAINT "custom_metric_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "custom_metric" ADD CONSTRAINT "custom_metric_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_metric_startup_uidx" ON "custom_metric" USING btree ("startup_id");
--> statement-breakpoint
CREATE INDEX "custom_metric_connector_idx" ON "custom_metric" USING btree ("connector_id");
--> statement-breakpoint
CREATE INDEX "custom_metric_status_idx" ON "custom_metric" USING btree ("status");
