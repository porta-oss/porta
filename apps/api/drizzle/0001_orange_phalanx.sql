CREATE TABLE "alert" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"metric_key" text NOT NULL,
	"severity" text NOT NULL,
	"value" numeric NOT NULL,
	"threshold" numeric NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"snoozed_until" timestamp with time zone,
	"fired_at" timestamp with time zone NOT NULL,
	"last_fired_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_status_check" CHECK ("alert"."status" IN ('active', 'acknowledged', 'snoozed', 'dismissed', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "alert_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"metric_key" text NOT NULL,
	"condition" text NOT NULL,
	"threshold" numeric NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_data_points" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rule_condition_check" CHECK ("alert_rule"."condition" IN ('drop_wow_pct', 'spike_vs_avg', 'below_threshold', 'above_threshold')),
	CONSTRAINT "alert_rule_severity_check" CHECK ("alert_rule"."severity" IN ('critical', 'high', 'medium', 'low'))
);
--> statement-breakpoint
CREATE TABLE "streak" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"current_days" integer DEFAULT 0 NOT NULL,
	"longest_days" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"broken_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "streak_startup_id_unique" UNIQUE("startup_id")
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scope" text DEFAULT 'read' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_scope_check" CHECK ("api_key"."scope" IN ('read', 'write'))
);
--> statement-breakpoint
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
	CONSTRAINT "connector_provider_check" CHECK ("connector"."provider" IN ('posthog', 'stripe', 'postgres', 'yookassa', 'sentry')),
	CONSTRAINT "connector_status_check" CHECK ("connector"."status" IN ('pending', 'connected', 'error', 'disconnected', 'stale'))
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
	CONSTRAINT "sync_job_status_check" CHECK ("sync_job"."status" IN ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "sync_job_trigger_check" CHECK ("sync_job"."trigger" IN ('initial', 'manual', 'scheduled'))
);
--> statement-breakpoint
CREATE TABLE "custom_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"metric_value" numeric,
	"previous_value" numeric,
	"delta" numeric,
	"captured_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"startup_id" text,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_log_actor_type_check" CHECK ("event_log"."actor_type" IN ('system', 'user', 'ai', 'mcp'))
);
--> statement-breakpoint
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
CREATE TABLE "health_funnel_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"value" integer NOT NULL,
	"position" integer NOT NULL,
	"snapshot_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"health_state" text NOT NULL,
	"blocked_reason" text,
	"north_star_key" text NOT NULL,
	"north_star_value" numeric,
	"north_star_previous_value" numeric,
	"supporting_metrics" jsonb NOT NULL,
	"sync_job_id" text,
	"computed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_snapshot_history" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"metric_key" text NOT NULL,
	"value" numeric NOT NULL,
	"snapshot_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "startup" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"stage" text NOT NULL,
	"timezone" text NOT NULL,
	"currency" text NOT NULL,
	"north_star_key" text DEFAULT 'mrr' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_config" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"bot_token" text NOT NULL,
	"bot_username" text,
	"chat_id" text,
	"verification_code" text,
	"verification_expires_at" timestamp with time zone,
	"digest_time" text DEFAULT '09:00' NOT NULL,
	"digest_timezone" text DEFAULT 'UTC' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_digest_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_config" (
	"id" text PRIMARY KEY NOT NULL,
	"startup_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"circuit_broken_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_rule_id_alert_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streak" ADD CONSTRAINT "streak_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector" ADD CONSTRAINT "connector_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_job" ADD CONSTRAINT "sync_job_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_metric" ADD CONSTRAINT "custom_metric_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_metric" ADD CONSTRAINT "custom_metric_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_task" ADD CONSTRAINT "internal_task_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_funnel_stage" ADD CONSTRAINT "health_funnel_stage_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_funnel_stage" ADD CONSTRAINT "health_funnel_stage_snapshot_id_health_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."health_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_snapshot" ADD CONSTRAINT "health_snapshot_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_snapshot_history" ADD CONSTRAINT "health_snapshot_history_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_snapshot_history" ADD CONSTRAINT "health_snapshot_history_snapshot_id_health_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."health_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_insight" ADD CONSTRAINT "startup_insight_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup" ADD CONSTRAINT "startup_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_config" ADD CONSTRAINT "telegram_config_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_config" ADD CONSTRAINT "webhook_config_startup_id_startup_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_startup_idx" ON "alert" USING btree ("startup_id");--> statement-breakpoint
CREATE INDEX "alert_status_idx" ON "alert" USING btree ("status");--> statement-breakpoint
CREATE INDEX "alert_startup_status_idx" ON "alert" USING btree ("startup_id","status");--> statement-breakpoint
CREATE INDEX "alert_rule_idx" ON "alert" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_rule_startup_idx" ON "alert_rule" USING btree ("startup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rule_startup_metric_condition_uidx" ON "alert_rule" USING btree ("startup_id","metric_key","condition");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash_uidx" ON "api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_key_workspace_idx" ON "api_key" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "api_key_prefix_idx" ON "api_key" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_startup_provider_uidx" ON "connector" USING btree ("startup_id","provider");--> statement-breakpoint
CREATE INDEX "connector_startupId_idx" ON "connector" USING btree ("startup_id");--> statement-breakpoint
CREATE INDEX "connector_status_idx" ON "connector" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_job_connectorId_idx" ON "sync_job" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "sync_job_status_idx" ON "sync_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_job_createdAt_idx" ON "sync_job" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_metric_startup_key_uidx" ON "custom_metric" USING btree ("startup_id","key");--> statement-breakpoint
CREATE INDEX "custom_metric_connector_idx" ON "custom_metric" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "event_log_workspace_created_idx" ON "event_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "event_log_startup_created_idx" ON "event_log" USING btree ("startup_id","created_at");--> statement-breakpoint
CREATE INDEX "event_log_type_idx" ON "event_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "event_log_created_idx" ON "event_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_task_startup_insight_action_uidx" ON "internal_task" USING btree ("startup_id","source_insight_id","source_action_index");--> statement-breakpoint
CREATE INDEX "internal_task_startupId_idx" ON "internal_task" USING btree ("startup_id");--> statement-breakpoint
CREATE INDEX "internal_task_syncStatus_idx" ON "internal_task" USING btree ("sync_status");--> statement-breakpoint
CREATE INDEX "internal_task_createdAt_idx" ON "internal_task" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "health_funnel_stage_startupId_idx" ON "health_funnel_stage" USING btree ("startup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_funnel_stage_startup_key_uidx" ON "health_funnel_stage" USING btree ("startup_id","key");--> statement-breakpoint
CREATE INDEX "health_funnel_stage_snapshotId_idx" ON "health_funnel_stage" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_snapshot_startup_uidx" ON "health_snapshot" USING btree ("startup_id");--> statement-breakpoint
CREATE INDEX "health_snapshot_healthState_idx" ON "health_snapshot" USING btree ("health_state");--> statement-breakpoint
CREATE INDEX "health_snapshot_computedAt_idx" ON "health_snapshot" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "health_snapshot_history_startup_metric_idx" ON "health_snapshot_history" USING btree ("startup_id","metric_key","captured_at");--> statement-breakpoint
CREATE INDEX "health_snapshot_history_captured_idx" ON "health_snapshot_history" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "startup_insight_startup_uidx" ON "startup_insight" USING btree ("startup_id");--> statement-breakpoint
CREATE INDEX "startup_insight_conditionCode_idx" ON "startup_insight" USING btree ("condition_code");--> statement-breakpoint
CREATE INDEX "startup_insight_generationStatus_idx" ON "startup_insight" USING btree ("generation_status");--> statement-breakpoint
CREATE INDEX "startup_insight_generatedAt_idx" ON "startup_insight" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "startup_workspaceId_idx" ON "startup" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "startup_workspace_name_uidx" ON "startup" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_config_workspace_uidx" ON "telegram_config" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "telegram_config_chat_idx" ON "telegram_config" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_config_startup_uidx" ON "webhook_config" USING btree ("startup_id");--> statement-breakpoint
CREATE INDEX "webhook_config_enabled_idx" ON "webhook_config" USING btree ("enabled");--> statement-breakpoint
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
