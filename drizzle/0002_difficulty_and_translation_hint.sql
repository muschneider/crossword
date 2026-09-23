ALTER TABLE "crossword_entries" ADD COLUMN "used_translation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crosswords" ADD COLUMN "difficulty" text DEFAULT 'hard' NOT NULL;--> statement-breakpoint
ALTER TABLE "crosswords" ADD COLUMN "givens" jsonb DEFAULT '[]'::jsonb NOT NULL;