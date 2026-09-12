ALTER TYPE "public"."ai_job_kind" ADD VALUE IF NOT EXISTS 'differenzierung';--> statement-breakpoint
ALTER TABLE "material_variants" ADD COLUMN IF NOT EXISTS "ai_meta" jsonb;--> statement-breakpoint
DELETE FROM "app_settings" WHERE "key" = 'ki.hermes';
