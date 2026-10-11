CREATE TABLE IF NOT EXISTS "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"permission" text DEFAULT 'ansehen' NOT NULL,
	"label" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "share_links_entity_type_check" CHECK ("entity_type" IN ('material', 'reihe')),
	CONSTRAINT "share_links_permission_check" CHECK ("permission" IN ('ansehen', 'bearbeiten'))
);--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "share_links_entity_idx" ON "share_links" USING btree ("entity_type","entity_id");
