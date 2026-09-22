import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  crosswordEntries,
  crosswords,
  words,
  type Crossword,
  type CrosswordEntry,
  type NewCrosswordEntry,
  type ProgressGrid,
} from "@/db/schema";
import { env } from "@/lib/env";
import { MAX_GRID_LENGTH, MIN_GRID_LENGTH } from "@/lib/words";
import { buildClues } from "./clues";
import { generateLayout } from "./generator";
import { createRng, randomSeed } from "./random";
import { resample, selectWords } from "./selector";
import type { GeneratedLayout } from "./types";

export type ActiveCrossword = {
  crossword: Crossword;
  entries: CrosswordEntry[];
};

export async function getActiveCrossword(userId: string): Promise<ActiveCrossword | null> {
  const [crossword] = await db
    .select()
    .from(crosswords)
    .where(and(eq(crosswords.userId, userId), eq(crosswords.status, "active")))
    .limit(1);

  if (!crossword) return null;

  const entries = await db
    .select()
    .from(crosswordEntries)
    .where(eq(crosswordEntries.crosswordId, crossword.id))
    .orderBy(asc(crosswordEntries.number), asc(crosswordEntries.direction));

  return { crossword, entries };
}

/**
 * The puzzle the user is looking at: the active one, or — when there is none —
 * the last one they finished, so the solution stays visible until they start a
 * new puzzle.
 */
export async function getCurrentCrossword(userId: string): Promise<ActiveCrossword | null> {
  const active = await getActiveCrossword(userId);
  if (active) return active;

  const [latest] = await db
    .select()
    .from(crosswords)
    .where(eq(crosswords.userId, userId))
    .orderBy(desc(crosswords.createdAt))
    .limit(1);

  if (!latest) return null;
  return getCrosswordById(userId, latest.id);
}

export async function listCrosswords(userId: string, limit = 10): Promise<Crossword[]> {
  return db
    .select()
    .from(crosswords)
    .where(eq(crosswords.userId, userId))
    .orderBy(desc(crosswords.createdAt))
    .limit(limit);
}

export async function getCrosswordById(
  userId: string,
  crosswordId: string,
): Promise<ActiveCrossword | null> {
  const [crossword] = await db
    .select()
    .from(crosswords)
    .where(and(eq(crosswords.id, crosswordId), eq(crosswords.userId, userId)))
    .limit(1);

  if (!crossword) return null;

  const entries = await db
    .select()
    .from(crosswordEntries)
    .where(eq(crosswordEntries.crosswordId, crossword.id))
    .orderBy(asc(crosswordEntries.number), asc(crosswordEntries.direction));

  return { crossword, entries };
}

/** Good-enough layout: enough words placed and everything interlocked. */
function layoutScore(layout: GeneratedLayout): number {
  return layout.entries.length * 100 + layout.intersections * 10;
}

/**
 * Candidates for the next puzzle, already narrowed down in Postgres.
 *
 * Only grid-usable lengths are fetched, ordered by rotation priority, with a
 * `random()` tiebreaker so a vocabulary where everything is unused does not
 * always yield the same page of rows. The LIMIT keeps generation O(1) in
 * memory no matter how large the vocabulary grows.
 */
async function fetchRotationCandidates(userId: string, limit: number) {
  return db
    .select()
    .from(words)
    .where(
      and(
        eq(words.userId, userId),
        sql`length(${words.answer}) between ${MIN_GRID_LENGTH} and ${MAX_GRID_LENGTH}`,
      ),
    )
    .orderBy(
      asc(words.usageCount),
      sql`${words.lastUsedAt} asc nulls first`,
      sql`random()`,
    )
    .limit(limit);
}

export async function generateCrosswordForUser(userId: string): Promise<Crossword> {
  const existing = await getActiveCrossword(userId);
  if (existing) {
    throw new Error(
      "Você já tem um crossword em andamento. Finalize ou remova o atual antes de gerar outro.",
    );
  }

  const vocabulary = await fetchRotationCandidates(
    userId,
    Math.max(env.CROSSWORD_CANDIDATE_POOL * 10, 300),
  );
  const seed = randomSeed();
  const rng = createRng(seed);

  const selection = selectWords(vocabulary, {
    targetWords: env.CROSSWORD_TARGET_WORDS,
    poolSize: env.CROSSWORD_CANDIDATE_POOL,
    rng,
  });

  // Try a few different subsets and keep the richest layout.
  let best = generateLayout(selection.chosen, { seed: randomSeed() });
  const minimumAcceptable = Math.min(selection.chosen.length, 8);

  for (let attempt = 0; attempt < 3 && best.entries.length < minimumAcceptable; attempt += 1) {
    const candidate = generateLayout(resample(selection.pool, env.CROSSWORD_TARGET_WORDS, rng), {
      seed: randomSeed(),
    });
    if (layoutScore(candidate) > layoutScore(best)) best = candidate;
  }

  if (best.entries.length < 3) {
    throw new Error(
      "Não foi possível montar um crossword com as palavras disponíveis. " +
        "Adicione mais palavras (de 3 a 15 letras) e tente novamente.",
    );
  }

  const clues = await buildClues(best.entries, env.CROSSWORD_AI_CLUE_RATIO, rng);

  const [{ total }] = await db
    .select({ total: count() })
    .from(crosswords)
    .where(eq(crosswords.userId, userId));

  const crosswordId = crypto.randomUUID();
  const usedWordIds = best.entries.map((entry) => entry.id);

  const progress: ProgressGrid = best.grid.map((row) => row.map(() => ""));

  const entryRows: NewCrosswordEntry[] = best.entries.map((entry) => {
    const clue = clues.get(entry.id) ?? { clue: entry.translation, clueSource: "translation" as const };
    return {
      crosswordId,
      wordId: entry.id,
      number: entry.number,
      direction: entry.direction,
      row: entry.row,
      col: entry.col,
      answer: entry.answer,
      term: entry.term,
      translation: entry.translation,
      clue: clue.clue,
      clueSource: clue.clueSource,
    };
  });

  try {
    // Neon's HTTP batch runs every statement inside a single transaction.
    await db.batch([
      db.insert(crosswords).values({
        id: crosswordId,
        userId,
        title: `Crossword #${total + 1}`,
        status: "active",
        width: best.width,
        height: best.height,
        grid: best.grid,
        progress,
      }),
      db.insert(crosswordEntries).values(entryRows),
      db
        .update(words)
        .set({
          usageCount: sql`${words.usageCount} + 1`,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(words.userId, userId), inArray(words.id, usedWordIds))),
    ]);
  } catch (error) {
    if (String(error).includes("crosswords_one_active_per_user_uq")) {
      throw new Error("Você já tem um crossword em andamento.");
    }
    throw error;
  }

  const [created] = await db.select().from(crosswords).where(eq(crosswords.id, crosswordId));
  return created;
}

export async function saveProgress(
  userId: string,
  crosswordId: string,
  progress: ProgressGrid,
): Promise<void> {
  await db
    .update(crosswords)
    .set({ progress, updatedAt: new Date() })
    .where(
      and(
        eq(crosswords.id, crosswordId),
        eq(crosswords.userId, userId),
        eq(crosswords.status, "active"),
      ),
    );
}

export type CompletionCheck = {
  solved: boolean;
  correctCells: number;
  totalCells: number;
  wrongEntries: number[];
};

export function checkGrid(
  grid: (string | null)[][],
  progress: ProgressGrid,
  entries: CrosswordEntry[],
): CompletionCheck {
  let correctCells = 0;
  let totalCells = 0;

  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      const expected = grid[row][col];
      if (expected === null) continue;
      totalCells += 1;
      if ((progress[row]?.[col] ?? "").toUpperCase() === expected) correctCells += 1;
    }
  }

  const wrongEntries: number[] = [];
  for (const entry of entries) {
    const dr = entry.direction === "down" ? 1 : 0;
    const dc = entry.direction === "across" ? 1 : 0;
    let ok = true;
    for (let i = 0; i < entry.answer.length; i += 1) {
      const filled = (progress[entry.row + dr * i]?.[entry.col + dc * i] ?? "").toUpperCase();
      if (filled !== entry.answer[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) wrongEntries.push(entry.number);
  }

  return {
    solved: totalCells > 0 && correctCells === totalCells,
    correctCells,
    totalCells,
    wrongEntries,
  };
}

/**
 * A reveal hands out `ceil(length / REVEAL_CLICKS)` letters, so any word takes
 * about this many clicks to come out in full regardless of how long it is.
 */
export const REVEAL_CLICKS = 3;

export type RevealBatch = {
  /** `[row, col, letter]` triples to write into the grid. */
  cells: [number, number, string][];
  /** Letters of the entry correct on the grid *after* applying `cells`. */
  revealed: number;
  /** Length of the entry. */
  total: number;
  /** `true` once every letter of the entry is on the grid. */
  complete: boolean;
};

/**
 * Picks the next slice of letters to reveal for an entry, left to right.
 *
 * Stateless: "what is still missing" is derived from `progress` on every call,
 * so repeated calls walk the word to completion and an erased letter simply
 * becomes pending again. A cell holding a *wrong* letter counts as pending too
 * — revealing must always make visible progress.
 */
export function nextRevealCells(
  entry: Pick<CrosswordEntry, "row" | "col" | "direction" | "answer">,
  progress: ProgressGrid,
  clicks: number = REVEAL_CLICKS,
): RevealBatch {
  const dr = entry.direction === "down" ? 1 : 0;
  const dc = entry.direction === "across" ? 1 : 0;
  const total = entry.answer.length;

  const pending: [number, number, string][] = [];
  for (let i = 0; i < total; i += 1) {
    const row = entry.row + dr * i;
    const col = entry.col + dc * i;
    const letter = entry.answer[i];
    if ((progress[row]?.[col] ?? "").toUpperCase() !== letter) pending.push([row, col, letter]);
  }

  if (pending.length === 0) {
    return { cells: [], revealed: total, total, complete: true };
  }

  const cells = pending.slice(0, Math.max(1, Math.ceil(total / Math.max(1, clicks))));
  const revealed = total - (pending.length - cells.length);

  return { cells, revealed, total, complete: revealed === total };
}

export async function completeCrossword(userId: string, crosswordId: string): Promise<void> {
  const current = await getCrosswordById(userId, crosswordId);
  if (!current) throw new Error("Crossword não encontrado.");

  const check = checkGrid(current.crossword.grid, current.crossword.progress, current.entries);
  if (!check.solved) {
    throw new Error("O crossword ainda não está completamente correto.");
  }

  await db.batch([
    db
      .update(crosswords)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(crosswords.id, crosswordId), eq(crosswords.userId, userId))),
    db
      .update(crosswordEntries)
      .set({ solved: true })
      .where(eq(crosswordEntries.crosswordId, crosswordId)),
  ]);
}

export async function deleteCrossword(userId: string, crosswordId: string): Promise<void> {
  await db
    .delete(crosswords)
    .where(and(eq(crosswords.id, crosswordId), eq(crosswords.userId, userId)));
}
