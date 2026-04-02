CREATE TABLE "startup_insight" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"condition_code" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"explanation" jsonb,
	"generation_status" text NOT NULL,
	"last_error" text,
	"model" text,
	"explainer_latency_ms" integer,
	"generated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "startup_insight" ADD CONSTRAINT "startup_insight_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "startup_insight_startup_uidx" ON "startup_insight" USING btree ("startup_id");
--> statement-breakpoint
CREATE INDEX "startup_insight_conditionCode_idx" ON "startup_insight" USING btree ("condition_code");
--> statement-breakpoint
CREATE INDEX "startup_insight_generationStatus_idx" ON "startup_insight" USING btree ("generation_status");
--> statement-breakpoint
CREATE INDEX "startup_insight_generatedAt_idx" ON "startup_insight" USING btree ("generated_at");
