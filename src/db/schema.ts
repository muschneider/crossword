import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { Difficulty, GivenCell } from "@/lib/crossword/difficulty";

/* -------------------------------------------------------------------------- */
/*                              Accounts & sessions                           */
/* -------------------------------------------------------------------------- */

export type UserRole = "user" | "admin";
export type UserStatus = "pending" | "approved" | "rejected";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    /** Lowercased email — the real uniqueness key. */
    emailNormalized: text("email_normalized").notNull(),
    /** `scrypt$N$r$p$<salt b64>$<hash b64>` — see src/lib/password.ts. */
    passwordHash: text("password_hash").notNull(),

    role: text("role").$type<UserRole>().notNull().default("user"),
    status: text("status").$type<UserStatus>().notNull().default("pending"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),

    /** Throttling for password guessing (no Redis needed on the free tier). */
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_normalized_uq").on(table.emailNormalized)],
);

export const sessions = pgTable(
  "sessions",
  {
    /**
     * SHA-256 of the cookie value, never the value itself: a database dump
     * cannot be replayed as a valid session.
     */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    /** SHA-256 of the token that goes in the e-mail link. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("password_reset_tokens_user_id_idx").on(table.userId)],
);

/* -------------------------------------------------------------------------- */
/*                                   Words                                    */
/* -------------------------------------------------------------------------- */

export const words = pgTable(
  "words",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Original term as typed by the user, e.g. `as far as I know`. */
    term: text("term").notNull(),
    /** Lowercased / whitespace-collapsed term. Used for per-user de-duplication. */
    normalized: text("normalized").notNull(),
    /** A-Z only, uppercase. This is what actually goes into the grid. */
    answer: text("answer").notNull(),
    /** Portuguese meaning(s), e.g. `realizar / alcançar / cumprir`. */
    translation: text("translation").notNull(),

    /** How many generated crosswords already used this word. */
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    /* ------------------------- spaced repetition ------------------------- */

    /**
     * Leitner box, 0..5. Drives both *when* the word comes back and *how hard*
     * its clue is — always in English: 0-1 a plain explanation with a helping
     * hand, 2-3 a dictionary definition, 4-5 a short crossword-style clue.
     */
    level: integer("level").notNull().default(0),
    /** When the word becomes a priority again. `null` = never practised yet. */
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** Consecutive puzzles solved without a hint or a wrong check. */
    streak: integer("streak").notNull().default(0),
    /** Best streak ever reached — survives a demotion. */
    bestStreak: integer("best_streak").notNull().default(0),
    /** Puzzles where the word came out clean. */
    correctCount: integer("correct_count").notNull().default(0),
    /** Puzzles where the word needed a hint or was typed wrong. */
    missCount: integer("miss_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("words_user_normalized_uq").on(table.userId, table.normalized),
    index("words_user_rotation_idx").on(table.userId, table.usageCount, table.lastUsedAt),
    /** Serves the "what is due for review" ordering used by the selector. */
    index("words_user_due_idx").on(table.userId, table.dueAt, table.level),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                 Crosswords                                 */
/* -------------------------------------------------------------------------- */

export type CrosswordStatus = "active" | "completed";

/** Solution grid: `null` = blocked cell, otherwise a single uppercase letter. */
export type SolutionGrid = (string | null)[][];
/** Player grid: `""` = empty, otherwise a single uppercase letter. */
export type ProgressGrid = string[][];

export const crosswords = pgTable(
  "crosswords",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    status: text("status").$type<CrosswordStatus>().notNull().default("active"),

    width: integer("width").notNull(),
    height: integer("height").notNull(),

    grid: jsonb("grid").$type<SolutionGrid>().notNull(),
    progress: jsonb("progress").$type<ProgressGrid>().notNull(),

    /**
     * Chosen when the puzzle is generated. Decides how many letters start on
     * the board; rows created before difficulty existed had none, hence `hard`.
     */
    difficulty: text("difficulty").$type<Difficulty>().notNull().default("hard"),
    /**
     * `[row, col]` of the cells that came pre-filled. Locked: the server writes
     * them back into every progress it receives, so they cannot be erased.
     */
    givens: jsonb("givens")
      .$type<GivenCell[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    /** Wall-clock seconds spent on this puzzle, accumulated by the player. */
    secondsPlayed: integer("seconds_played").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    // Hard guarantee: at most one *active* crossword per user.
    uniqueIndex("crosswords_one_active_per_user_uq")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    index("crosswords_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export type EntryDirection = "across" | "down";

/**
 * How the clue was written, which doubles as its difficulty tier:
 *  - `simple`:      plain English plus a helping hand (levels 0-1);
 *  - `definition`:  English dictionary-style definition (levels 2-3);
 *  - `crossword`:   short newspaper-style clue (levels 4-5);
 *  - `translation`: the Portuguese meaning — only when the AI is unavailable;
 *  - `sentence`:    legacy fill-in-the-blank clue, no longer generated.
 *
 * The legacy `ai` value is rewritten to `sentence` by migration 0001.
 */
export type ClueSource = "simple" | "definition" | "crossword" | "translation" | "sentence";

export const crosswordEntries = pgTable(
  "crossword_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crosswordId: uuid("crossword_id")
      .notNull()
      .references(() => crosswords.id, { onDelete: "cascade" }),
    /** Kept nullable so deleting a word never destroys crossword history. */
    wordId: uuid("word_id").references(() => words.id, { onDelete: "set null" }),

    number: integer("number").notNull(),
    direction: text("direction").$type<EntryDirection>().notNull(),
    row: integer("row").notNull(),
    col: integer("col").notNull(),

    /** A-Z only, uppercase — matches the grid. */
    answer: text("answer").notNull(),
    /** Human readable term, e.g. `as far as I know`. */
    term: text("term").notNull(),
    translation: text("translation").notNull(),

    clue: text("clue").notNull(),
    clueSource: text("clue_source").$type<ClueSource>().notNull(),

    solved: boolean("solved").notNull().default(false),

    /* --------------------- how hard this one was ------------------------- */

    /** Letters handed out by the hint button. Server-authoritative. */
    revealedCount: integer("revealed_count").notNull().default(0),
    /** Times a check caught this entry fully filled in and wrong. */
    wrongChecks: integer("wrong_checks").notNull().default(0),
    /**
     * The Portuguese meaning was shown while the word was still unsolved.
     * Server-authoritative, like the two counters above; looking it up after
     * the word is already right costs nothing.
     */
    usedTranslation: boolean("used_translation").notNull().default(false),
  },
  (table) => [
    index("crossword_entries_crossword_idx").on(table.crosswordId),
    uniqueIndex("crossword_entries_number_direction_uq").on(
      table.crosswordId,
      table.number,
      table.direction,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Word = typeof words.$inferSelect;
export type NewWord = typeof words.$inferInsert;
export type Crossword = typeof crosswords.$inferSelect;
export type CrosswordEntry = typeof crosswordEntries.$inferSelect;
export type NewCrosswordEntry = typeof crosswordEntries.$inferInsert;
