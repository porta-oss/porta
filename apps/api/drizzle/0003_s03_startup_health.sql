CREATE TABLE "health_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"health_state" text NOT NULL,
	"blocked_reason" text,
	"north_star_key" text NOT NULL,
	"north_star_value" integer NOT NULL,
	"north_star_previous_value" integer,
	"supporting_metrics" jsonb NOT NULL,
	"sync_job_id" text,
	"computed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_funnel_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"stage" text NOT NULL,
	"label" text NOT NULL,
	"value" integer NOT NULL,
	"position" integer NOT NULL,
	"snapshot_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_snapshot" ADD CONSTRAINT "health_snapshot_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "health_funnel_stage" ADD CONSTRAINT "health_funnel_stage_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "health_funnel_stage" ADD CONSTRAINT "health_funnel_stage_snapshot_id_health_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."health_snapshot"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "health_snapshot_startup_uidx" ON "health_snapshot" USING btree ("startup_id");
--> statement-breakpoint
CREATE INDEX "health_snapshot_healthState_idx" ON "health_snapshot" USING btree ("health_state");
--> statement-breakpoint
CREATE INDEX "health_snapshot_computedAt_idx" ON "health_snapshot" USING btree ("computed_at");
--> statement-breakpoint
CREATE INDEX "health_funnel_stage_startupId_idx" ON "health_funnel_stage" USING btree ("startup_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "health_funnel_stage_startup_stage_uidx" ON "health_funnel_stage" USING btree ("startup_id","stage");
--> statement-breakpoint
CREATE INDEX "health_funnel_stage_snapshotId_idx" ON "health_funnel_stage" USING btree ("snapshot_id");
