CREATE TABLE "startup" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"stage" text NOT NULL,
	"timezone" text NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "startup_type_check" CHECK ("type" IN ('b2b_saas')),
	CONSTRAINT "startup_stage_check" CHECK ("stage" IN ('idea', 'mvp', 'growth')),
	CONSTRAINT "startup_timezone_check" CHECK ("timezone" IN ('UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin')),
	CONSTRAINT "startup_currency_check" CHECK ("currency" IN ('USD', 'EUR', 'GBP'))
);
--> statement-breakpoint
ALTER TABLE "startup" ADD CONSTRAINT "startup_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "startup_workspaceId_idx" ON "startup" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "startup_workspace_name_uidx" ON "startup" USING btree ("workspace_id", "name");
