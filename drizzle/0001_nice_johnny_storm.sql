ALTER TABLE "crossword_entries" ADD COLUMN "revealed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crossword_entries" ADD COLUMN "wrong_checks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crosswords" ADD COLUMN "seconds_played" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "best_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "correct_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "miss_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "words_user_due_idx" ON "words" USING btree ("user_id","due_at","level");--> statement-breakpoint
-- The old `ai` clue source became the `sentence` tier.
UPDATE "crossword_entries" SET "clue_source" = 'sentence' WHERE "clue_source" = 'ai';