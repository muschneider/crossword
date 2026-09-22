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

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("words_user_normalized_uq").on(table.userId, table.normalized),
    index("words_user_rotation_idx").on(table.userId, table.usageCount, table.lastUsedAt),
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
export type ClueSource = "translation" | "ai";

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
