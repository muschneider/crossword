CREATE TABLE "crossword_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crossword_id" uuid NOT NULL,
	"word_id" uuid,
	"number" integer NOT NULL,
	"direction" text NOT NULL,
	"row" integer NOT NULL,
	"col" integer NOT NULL,
	"answer" text NOT NULL,
	"term" text NOT NULL,
	"translation" text NOT NULL,
	"clue" text NOT NULL,
	"clue_source" text NOT NULL,
	"solved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crosswords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"grid" jsonb NOT NULL,
	"progress" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"term" text NOT NULL,
	"normalized" text NOT NULL,
	"answer" text NOT NULL,
	"translation" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crossword_entries" ADD CONSTRAINT "crossword_entries_crossword_id_crosswords_id_fk" FOREIGN KEY ("crossword_id") REFERENCES "public"."crosswords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crossword_entries" ADD CONSTRAINT "crossword_entries_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosswords" ADD CONSTRAINT "crosswords_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crossword_entries_crossword_idx" ON "crossword_entries" USING btree ("crossword_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crossword_entries_number_direction_uq" ON "crossword_entries" USING btree ("crossword_id","number","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "crosswords_one_active_per_user_uq" ON "crosswords" USING btree ("user_id") WHERE "crosswords"."status" = 'active';--> statement-breakpoint
CREATE INDEX "crosswords_user_created_idx" ON "crosswords" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_uq" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "words_user_normalized_uq" ON "words" USING btree ("user_id","normalized");--> statement-breakpoint
CREATE INDEX "words_user_rotation_idx" ON "words" USING btree ("user_id","usage_count","last_used_at");