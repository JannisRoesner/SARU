ALTER TYPE "material_type" ADD VALUE IF NOT EXISTS 'abbildungssammlung';--> statement-breakpoint
ALTER TYPE "search_entity_type" ADD VALUE IF NOT EXISTS 'abbildung';--> statement-breakpoint
ALTER TYPE "material_relation_type" ADD VALUE IF NOT EXISTS 'bezug';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_abbildungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"titel" text DEFAULT '' NOT NULL,
	"beschreibung" text,
	"werk" text,
	"seite" text,
	"abbildung" text,
	"kapitel" text,
	"schlagwoerter" text[] DEFAULT '{}'::text[] NOT NULL,
	"beschriftet" boolean,
	"variante_von" uuid,
	"original" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"herkunft" text DEFAULT 'dateiname' NOT NULL,
	"ki_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "material_abbildungen" ADD CONSTRAINT "material_abbildungen_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_abbildungen" ADD CONSTRAINT "material_abbildungen_asset_id_material_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."material_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_abbildungen" ADD CONSTRAINT "material_abbildungen_variante_von_material_abbildungen_id_fk" FOREIGN KEY ("variante_von") REFERENCES "public"."material_abbildungen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "material_abbildungen_asset_uq" ON "material_abbildungen" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_abbildungen_material_idx" ON "material_abbildungen" USING btree ("material_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_abbildungen_variante_idx" ON "material_abbildungen" USING btree ("variante_von");
