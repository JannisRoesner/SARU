CREATE TYPE "public"."ai_job_kind" AS ENUM('musterloesung', 'zusammenfassung', 'verschlagwortung', 'embedding');--> statement-breakpoint
CREATE TYPE "public"."ai_job_status" AS ENUM('wartend', 'laeuft', 'erfolgreich', 'fehlgeschlagen');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('openai', 'ollama', 'openrouter');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('datei', 'link');--> statement-breakpoint
CREATE TYPE "public"."asset_role" AS ENUM('haupt', 'anhang');--> statement-breakpoint
CREATE TYPE "public"."differentiation_level" AS ENUM('grundlegend', 'mittel', 'erweitert');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('ausstehend', 'laeuft', 'erfolgreich', 'fehlgeschlagen', 'nicht_unterstuetzt');--> statement-breakpoint
CREATE TYPE "public"."import_item_action" AS ENUM('erstellt', 'verknuepft', 'uebersprungen', 'fehlgeschlagen');--> statement-breakpoint
CREATE TYPE "public"."import_log_level" AS ENUM('info', 'warnung', 'fehler');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('analysiert', 'vorschau', 'laeuft', 'importiert', 'teilweise_importiert', 'fehlgeschlagen', 'rueckgaengig');--> statement-breakpoint
CREATE TYPE "public"."lesson_status" AS ENUM('entwurf', 'geplant', 'durchgefuehrt', 'ueberarbeitet', 'ausgefallen');--> statement-breakpoint
CREATE TYPE "public"."material_relation_type" AS ENUM('musterloesung', 'loesung', 'zusatzmaterial', 'differenzierung', 'gehoert_zu', 'nachfolger', 'quelle');--> statement-breakpoint
CREATE TYPE "public"."material_type" AS ENUM('arbeitsblatt', 'musterloesung', 'loesung', 'lehrwerk', 'lehrbuchseite', 'loesungsbuch', 'unterrichtsentwurf', 'praesentation', 'bild', 'video', 'link', 'aufgabe', 'lernkontrolle', 'klausur', 'zusatzmaterial', 'differenzierung', 'notiz', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."material_usage" AS ENUM('unterricht', 'hausaufgabe', 'differenzierung', 'lehrkraft', 'leistungsnachweis');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('manuell', 'ki', 'import');--> statement-breakpoint
CREATE TYPE "public"."school_form" AS ENUM('grundschule', 'hauptschule', 'realschule', 'gesamtschule', 'gymnasium', 'oberstufe', 'berufsschule', 'foerderschule', 'sonstige');--> statement-breakpoint
CREATE TYPE "public"."search_entity_type" AS ENUM('material', 'unterrichtsstunde', 'reihe');--> statement-breakpoint
CREATE TYPE "public"."series_status" AS ENUM('planung', 'aktiv', 'abgeschlossen', 'archiviert');--> statement-breakpoint
CREATE TYPE "public"."social_form" AS ENUM('plenum', 'einzelarbeit', 'partnerarbeit', 'gruppenarbeit', 'stationenarbeit', 'projektarbeit', 'sonstige');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'lehrkraft', 'leser');--> statement-breakpoint
CREATE TYPE "public"."variant_kind" AS ENUM('standard', 'differenzierung', 'jahrgang', 'sprache', 'sonstige');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"details" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'lehrkraft' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "competencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"area" text,
	"description" text,
	"subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competencies_name_subject_uq" UNIQUE("name","subject_id")
);
--> statement-breakpoint
CREATE TABLE "learning_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject_id" uuid,
	"grade_level" integer,
	"school_year" text,
	"school_form" "school_form",
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_groups_name_year_uq" UNIQUE("name","school_year")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"color" text DEFAULT '#3b82f6' NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"subject_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_name_parent_uq" UNIQUE("name","parent_id")
);
--> statement-breakpoint
CREATE TABLE "material_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"kind" "asset_kind" DEFAULT 'datei' NOT NULL,
	"role" "asset_role" DEFAULT 'haupt' NOT NULL,
	"title" text,
	"file_name" text,
	"storage_key" text,
	"mime_type" text,
	"size_bytes" bigint,
	"checksum" text,
	"url" text,
	"page_count" integer,
	"extracted_text" text,
	"extraction_status" "extraction_status" DEFAULT 'ausstehend' NOT NULL,
	"extraction_error" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_competencies" (
	"material_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	CONSTRAINT "material_competencies_material_id_competency_id_pk" PRIMARY KEY("material_id","competency_id")
);
--> statement-breakpoint
CREATE TABLE "material_grade_levels" (
	"material_id" uuid NOT NULL,
	"grade_level" integer NOT NULL,
	CONSTRAINT "material_grade_levels_material_id_grade_level_pk" PRIMARY KEY("material_id","grade_level")
);
--> statement-breakpoint
CREATE TABLE "material_learning_groups" (
	"material_id" uuid NOT NULL,
	"learning_group_id" uuid NOT NULL,
	CONSTRAINT "material_learning_groups_material_id_learning_group_id_pk" PRIMARY KEY("material_id","learning_group_id")
);
--> statement-breakpoint
CREATE TABLE "material_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_material_id" uuid NOT NULL,
	"to_material_id" uuid NOT NULL,
	"relation_type" "material_relation_type" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_relations_uq" UNIQUE("from_material_id","to_material_id","relation_type")
);
--> statement-breakpoint
CREATE TABLE "material_subjects" (
	"material_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "material_subjects_material_id_subject_id_pk" PRIMARY KEY("material_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "material_tags" (
	"material_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "material_tags_material_id_tag_id_pk" PRIMARY KEY("material_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "material_topics" (
	"material_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	CONSTRAINT "material_topics_material_id_topic_id_pk" PRIMARY KEY("material_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "material_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"label" text NOT NULL,
	"variant_kind" "variant_kind" DEFAULT 'standard' NOT NULL,
	"differentiation_level" "differentiation_level",
	"school_year" text,
	"version" text DEFAULT '1' NOT NULL,
	"notes" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"content" text,
	"material_type" "material_type" DEFAULT 'arbeitsblatt' NOT NULL,
	"school_form" "school_form",
	"source" text,
	"author" text,
	"pages" text,
	"notes" text,
	"learning_objectives" text[] DEFAULT '{}' NOT NULL,
	"rating" integer,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"origin" "origin" DEFAULT 'manuell' NOT NULL,
	"ai_meta" jsonb,
	"owner_id" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"subject_id" uuid,
	"learning_group_id" uuid,
	"topic_id" uuid,
	"start_date" date,
	"end_date" date,
	"school_year" text,
	"learning_objectives" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"status" "series_status" DEFAULT 'planung' NOT NULL,
	"origin" "origin" DEFAULT 'manuell' NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_competencies" (
	"series_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	CONSTRAINT "series_competencies_series_id_competency_id_pk" PRIMARY KEY("series_id","competency_id")
);
--> statement-breakpoint
CREATE TABLE "series_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"variant_id" uuid,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_tags" (
	"series_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "series_tags_series_id_tag_id_pk" PRIMARY KEY("series_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_competencies" (
	"lesson_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	CONSTRAINT "lesson_competencies_lesson_id_competency_id_pk" PRIMARY KEY("lesson_id","competency_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"variant_id" uuid,
	"usage" "material_usage" DEFAULT 'unterricht' NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_phase_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"variant_id" uuid,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer,
	"content" text,
	"teacher_activity" text,
	"student_activity" text,
	"method" text,
	"social_form" "social_form",
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_tags" (
	"lesson_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "lesson_tags_lesson_id_tag_id_pk" PRIMARY KEY("lesson_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"date" date,
	"schedule_note" text,
	"period_from" integer,
	"period_to" integer,
	"duration_minutes" integer,
	"subject_id" uuid,
	"learning_group_id" uuid,
	"topic_id" uuid,
	"learning_objectives" text[] DEFAULT '{}' NOT NULL,
	"method_summary" text,
	"homework" text,
	"notes" text,
	"reflection" text,
	"substitute_teacher" text,
	"status" "lesson_status" DEFAULT 'entwurf' NOT NULL,
	"origin" "origin" DEFAULT 'manuell' NOT NULL,
	"series_id" uuid,
	"position_in_series" integer,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort" text DEFAULT 'relevanz' NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_searches_user_name_uq" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "search_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "search_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"meta_text" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"source_label" text,
	"content_hash" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedded_at" timestamp with time zone,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('german', coalesce(title, '')), 'A')
          || setweight(to_tsvector('german', coalesce(meta_text, '')), 'B')
          || setweight(to_tsvector('german', coalesce(content, '')), 'C')) STORED NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_documents_entity_chunk_uq" UNIQUE("entity_type","entity_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "search_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"level" "import_log_level" DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_ref" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" "import_item_action" NOT NULL,
	"duplicate_of_id" uuid,
	"message" text,
	"payload" jsonb,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"source_file_name" text NOT NULL,
	"source_size_bytes" bigint,
	"source_checksum" text,
	"adapter_id" text NOT NULL,
	"adapter_version" text DEFAULT '1' NOT NULL,
	"status" "import_status" DEFAULT 'analysiert' NOT NULL,
	"detected" jsonb,
	"mapping" jsonb,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"staging_path" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"material_id" uuid,
	"result_material_id" uuid,
	"kind" "ai_job_kind" NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model" text NOT NULL,
	"status" "ai_job_status" DEFAULT 'wartend' NOT NULL,
	"prompt" text,
	"result" text,
	"error_message" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_groups" ADD CONSTRAINT "learning_groups_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_parent_id_topics_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_assets" ADD CONSTRAINT "material_assets_variant_id_material_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."material_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_competencies" ADD CONSTRAINT "material_competencies_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_competencies" ADD CONSTRAINT "material_competencies_competency_id_competencies_id_fk" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_grade_levels" ADD CONSTRAINT "material_grade_levels_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_learning_groups" ADD CONSTRAINT "material_learning_groups_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_learning_groups" ADD CONSTRAINT "material_learning_groups_learning_group_id_learning_groups_id_fk" FOREIGN KEY ("learning_group_id") REFERENCES "public"."learning_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_relations" ADD CONSTRAINT "material_relations_from_material_id_materials_id_fk" FOREIGN KEY ("from_material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_relations" ADD CONSTRAINT "material_relations_to_material_id_materials_id_fk" FOREIGN KEY ("to_material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_subjects" ADD CONSTRAINT "material_subjects_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_subjects" ADD CONSTRAINT "material_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_tags" ADD CONSTRAINT "material_tags_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_tags" ADD CONSTRAINT "material_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_topics" ADD CONSTRAINT "material_topics_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_topics" ADD CONSTRAINT "material_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_variants" ADD CONSTRAINT "material_variants_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_learning_group_id_learning_groups_id_fk" FOREIGN KEY ("learning_group_id") REFERENCES "public"."learning_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_competencies" ADD CONSTRAINT "series_competencies_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_competencies" ADD CONSTRAINT "series_competencies_competency_id_competencies_id_fk" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_materials" ADD CONSTRAINT "series_materials_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_materials" ADD CONSTRAINT "series_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_materials" ADD CONSTRAINT "series_materials_variant_id_material_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."material_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_tags" ADD CONSTRAINT "series_tags_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_tags" ADD CONSTRAINT "series_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_competencies" ADD CONSTRAINT "lesson_competencies_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_competencies" ADD CONSTRAINT "lesson_competencies_competency_id_competencies_id_fk" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_variant_id_material_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."material_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_phase_materials" ADD CONSTRAINT "lesson_phase_materials_phase_id_lesson_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."lesson_phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_phase_materials" ADD CONSTRAINT "lesson_phase_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_phase_materials" ADD CONSTRAINT "lesson_phase_materials_variant_id_material_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."material_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_phases" ADD CONSTRAINT "lesson_phases_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_tags" ADD CONSTRAINT "lesson_tags_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_tags" ADD CONSTRAINT "lesson_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_learning_group_id_learning_groups_id_fk" FOREIGN KEY ("learning_group_id") REFERENCES "public"."learning_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run_items" ADD CONSTRAINT "import_run_items_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_result_material_id_materials_id_fk" FOREIGN KEY ("result_material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "competencies_subject_idx" ON "competencies" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "learning_groups_subject_idx" ON "learning_groups" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "topics_parent_idx" ON "topics" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "topics_subject_idx" ON "topics" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "material_assets_variant_idx" ON "material_assets" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "material_assets_checksum_idx" ON "material_assets" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "material_assets_status_idx" ON "material_assets" USING btree ("extraction_status");--> statement-breakpoint
CREATE INDEX "material_competencies_competency_idx" ON "material_competencies" USING btree ("competency_id");--> statement-breakpoint
CREATE INDEX "material_grade_levels_grade_idx" ON "material_grade_levels" USING btree ("grade_level");--> statement-breakpoint
CREATE INDEX "material_learning_groups_group_idx" ON "material_learning_groups" USING btree ("learning_group_id");--> statement-breakpoint
CREATE INDEX "material_relations_from_idx" ON "material_relations" USING btree ("from_material_id");--> statement-breakpoint
CREATE INDEX "material_relations_to_idx" ON "material_relations" USING btree ("to_material_id");--> statement-breakpoint
CREATE INDEX "material_subjects_subject_idx" ON "material_subjects" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "material_tags_tag_idx" ON "material_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "material_topics_topic_idx" ON "material_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "material_variants_material_idx" ON "material_variants" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "material_variants_sort_idx" ON "material_variants" USING btree ("material_id","sort_order");--> statement-breakpoint
CREATE INDEX "materials_type_idx" ON "materials" USING btree ("material_type");--> statement-breakpoint
CREATE INDEX "materials_owner_idx" ON "materials" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "materials_archived_idx" ON "materials" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX "materials_favorite_idx" ON "materials" USING btree ("is_favorite");--> statement-breakpoint
CREATE INDEX "materials_updated_idx" ON "materials" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "materials_origin_idx" ON "materials" USING btree ("origin");--> statement-breakpoint
CREATE INDEX "series_subject_idx" ON "series" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "series_group_idx" ON "series" USING btree ("learning_group_id");--> statement-breakpoint
CREATE INDEX "series_status_idx" ON "series" USING btree ("status");--> statement-breakpoint
CREATE INDEX "series_updated_idx" ON "series" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "series_materials_series_idx" ON "series_materials" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "series_materials_material_idx" ON "series_materials" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "lesson_materials_lesson_idx" ON "lesson_materials" USING btree ("lesson_id","sort_order");--> statement-breakpoint
CREATE INDEX "lesson_materials_material_idx" ON "lesson_materials" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "lesson_phase_materials_phase_idx" ON "lesson_phase_materials" USING btree ("phase_id","sort_order");--> statement-breakpoint
CREATE INDEX "lesson_phase_materials_material_idx" ON "lesson_phase_materials" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "lesson_phases_lesson_idx" ON "lesson_phases" USING btree ("lesson_id","sort_order");--> statement-breakpoint
CREATE INDEX "lessons_date_idx" ON "lessons" USING btree ("date");--> statement-breakpoint
CREATE INDEX "lessons_series_idx" ON "lessons" USING btree ("series_id","position_in_series");--> statement-breakpoint
CREATE INDEX "lessons_subject_idx" ON "lessons" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "lessons_group_idx" ON "lessons" USING btree ("learning_group_id");--> statement-breakpoint
CREATE INDEX "lessons_status_idx" ON "lessons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lessons_updated_idx" ON "lessons" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "saved_searches_user_idx" ON "saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "search_documents_entity_idx" ON "search_documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "search_documents_tsv_idx" ON "search_documents" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_documents_title_trgm_idx" ON "search_documents" USING gin (title gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_documents_embedding_idx" ON "search_documents" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "search_history_user_idx" ON "search_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "import_logs_run_idx" ON "import_logs" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "import_run_items_run_idx" ON "import_run_items" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "import_run_items_entity_idx" ON "import_run_items" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "import_runs_user_idx" ON "import_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "import_runs_status_idx" ON "import_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_runs_started_idx" ON "import_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_material_idx" ON "ai_jobs" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_user_idx" ON "ai_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_status_idx" ON "ai_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_jobs_created_idx" ON "ai_jobs" USING btree ("created_at");