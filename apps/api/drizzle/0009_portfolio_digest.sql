CREATE TABLE "portfolio_digest" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"ai_synthesis" text,
	"structured_data" jsonb NOT NULL,
	"startup_count" integer NOT NULL DEFAULT 0,
	"synthesized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio_digest" ADD CONSTRAINT "portfolio_digest_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_digest_workspace_uidx" ON "portfolio_digest" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "portfolio_digest_synthesized_at_idx" ON "portfolio_digest" USING btree ("synthesized_at");
