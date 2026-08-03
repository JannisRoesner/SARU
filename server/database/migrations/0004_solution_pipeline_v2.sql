ALTER TYPE "public"."ai_job_status" ADD VALUE IF NOT EXISTS 'pruefung_noetig' BEFORE 'erfolgreich';--> statement-breakpoint
CREATE TABLE "ai_solution_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"pipeline_version" text DEFAULT '2' NOT NULL,
	"source_hash" text,
	"stage" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"plan" jsonb,
	"solution" jsonb,
	"render_manifest" jsonb,
	"quality_report" jsonb,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_storage_key" text,
	"draft_file_name" text,
	"draft_mime_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "ai_solution_runs" ADD CONSTRAINT "ai_solution_runs_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_solution_runs_job_unique" ON "ai_solution_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ai_solution_runs_stage_idx" ON "ai_solution_runs" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "ai_solution_runs_heartbeat_idx" ON "ai_solution_runs" USING btree ("heartbeat_at");
