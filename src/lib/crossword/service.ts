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
import {
  countGiven,
  DEFAULT_DIFFICULTY,
  pickGivens,
  type Difficulty,
  type GivenCell,
} from "./difficulty";
import { generateLayout } from "./generator";
import { createRng, randomSeed } from "./random";
import { applyOutcome, classifyOutcome, type OutcomeInput, type WordOutcome } from "./scheduling";
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
 * Only grid-usable lengths are fetched, ordered by the same three bands the
 * in-memory weighting uses — never practised, then due for review, then the
 * rest — with the weakest words first inside each band and a `random()`
 * tiebreaker so the same page of rows is not returned every time. The LIMIT
 * keeps generation O(1) in memory no matter how large the vocabulary grows.
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
      sql`case
            when ${words.usageCount} = 0 then 0
            when ${words.dueAt} is null or ${words.dueAt} <= now() then 1
            else 2
          end`,
      asc(words.level),
      sql`random()`,
    )
    .limit(limit);
}

/** English clues this learner already saw for each word, newest first (max 3). */
async function fetchRecentClues(
  userId: string,
  wordIds: string[],
): Promise<Map<string, string[]>> {
  const recent = new Map<string, string[]>();
  if (wordIds.length === 0) return recent;

  const rows = await db
    .select({ wordId: crosswordEntries.wordId, clue: crosswordEntries.clue })
    .from(crosswordEntries)
    .innerJoin(crosswords, eq(crosswords.id, crosswordEntries.crosswordId))
    .where(
      and(
        eq(crosswords.userId, userId),
        inArray(crosswordEntries.wordId, wordIds),
        inArray(crosswordEntries.clueSource, ["simple", "definition", "crossword"]),
      ),
    )
    .orderBy(desc(crosswords.createdAt))
    .limit(wordIds.length * 4);

  for (const row of rows) {
    if (!row.wordId) continue;
    const list = recent.get(row.wordId) ?? [];
    if (list.length < 3) list.push(row.clue);
    recent.set(row.wordId, list);
  }
  return recent;
}

export type GenerationResult = {
  crossword: Crossword;
  /** Clues that fell back to the Portuguese meaning because the AI had nothing. */
  fallbackClues: number;
};

export async function generateCrosswordForUser(
  userId: string,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
): Promise<GenerationResult> {
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

  const usedWordIds = best.entries.map((entry) => entry.id);
  const { clues, fallbacks } = await buildClues(best.entries, {
    avoid: await fetchRecentClues(userId, usedWordIds),
  });

  const [{ total }] = await db
    .select({ total: count() })
    .from(crosswords)
    .where(eq(crosswords.userId, userId));

  const crosswordId = crypto.randomUUID();

  // The letters the difficulty hands out start on the board, already right.
  const { cells: givens } = pickGivens(best.entries, difficulty, rng);
  const progress: ProgressGrid = best.grid.map((row) => row.map(() => ""));
  for (const [row, col] of givens) progress[row][col] = best.grid[row][col] ?? "";

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
        difficulty,
        givens,
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
  return { crossword: created, fallbackClues: fallbacks };
}

/**
 * Writes the pre-filled letters back into a progress grid.
 *
 * Givens are locked: whatever the client sends — an erased cell, a cleared
 * grid, a stale tab — they come back exactly as the puzzle started.
 */
export function applyGivens(
  progress: ProgressGrid,
  crossword: Pick<Crossword, "grid" | "givens">,
): ProgressGrid {
  for (const [row, col] of crossword.givens ?? []) {
    const letter = crossword.grid[row]?.[col];
    if (letter && progress[row]) progress[row][col] = letter;
  }
  return progress;
}

/** Every cell of the entry holds the right letter. */
export function isEntrySolved(entry: EntryShape, progress: ProgressGrid): boolean {
  return pendingCells(entry, progress).length === 0;
}

/**
 * Records that the Portuguese meaning helped with this entry. Idempotent: the
 * flag only matters once, when the puzzle is scored.
 */
export async function markTranslationUsed(crosswordId: string, entryId: string): Promise<void> {
  await db
    .update(crosswordEntries)
    .set({ usedTranslation: true })
    .where(
      and(eq(crosswordEntries.id, entryId), eq(crosswordEntries.crosswordId, crosswordId)),
    );
}

export async function saveProgress(
  userId: string,
  crosswordId: string,
  progress: ProgressGrid,
  secondsPlayed?: number,
): Promise<void> {
  await db
    .update(crosswords)
    .set({
      progress,
      updatedAt: new Date(),
      // Monotonic: a stale tab must never rewind the clock.
      ...(secondsPlayed !== undefined
        ? { secondsPlayed: sql`greatest(${crosswords.secondsPlayed}, ${secondsPlayed})` }
        : {}),
    })
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

/** `[row, col, letter]` triples to write into the grid. */
export type RevealCells = [number, number, string][];

type EntryShape = Pick<CrosswordEntry, "row" | "col" | "direction" | "answer">;

/** `true` when the cell is one of the entry's own. */
export function entryCovers(entry: EntryShape, row: number, col: number): boolean {
  if (entry.direction === "across") {
    return entry.row === row && col >= entry.col && col < entry.col + entry.answer.length;
  }
  return entry.col === col && row >= entry.row && row < entry.row + entry.answer.length;
}

/** Cells of an entry that do not yet hold the right letter. */
function pendingCells(entry: EntryShape, progress: ProgressGrid): RevealCells {
  const dr = entry.direction === "down" ? 1 : 0;
  const dc = entry.direction === "across" ? 1 : 0;

  const pending: RevealCells = [];
  for (let i = 0; i < entry.answer.length; i += 1) {
    const row = entry.row + dr * i;
    const col = entry.col + dc * i;
    const letter = entry.answer[i];
    if ((progress[row]?.[col] ?? "").toUpperCase() !== letter) pending.push([row, col, letter]);
  }
  return pending;
}

/**
 * Reveals one cell — the one the cursor is on, if it still needs a letter, and
 * otherwise the first cell of the entry that does.
 *
 * Stateless: what is missing is recomputed from `progress` every time, so an
 * erased letter simply becomes pending again. A cell holding a *wrong* letter
 * counts as pending too — a reveal must always make visible progress.
 */
export function revealLetter(
  entry: EntryShape,
  progress: ProgressGrid,
  cursor?: { row: number; col: number },
): RevealCells {
  const pending = pendingCells(entry, progress);
  if (pending.length === 0) return [];

  const atCursor =
    cursor && pending.find(([row, col]) => row === cursor.row && col === cursor.col);
  return [atCursor ?? pending[0]];
}

/** Reveals every letter the entry is still missing. */
export function revealWord(entry: EntryShape, progress: ProgressGrid): RevealCells {
  return pendingCells(entry, progress);
}

/** How one entry of a finished puzzle is scored — see `classifyOutcome`. */
export function entryOutcome(
  entry: Pick<
    CrosswordEntry,
    "row" | "col" | "direction" | "answer" | "revealedCount" | "wrongChecks" | "usedTranslation"
  >,
  givens: GivenCell[],
): WordOutcome {
  const input: OutcomeInput = {
    length: entry.answer.length,
    revealedCount: entry.revealedCount,
    wrongChecks: entry.wrongChecks,
    givenCount: countGiven(entry, givens),
    usedTranslation: entry.usedTranslation,
  };
  return classifyOutcome(input);
}

/**
 * Feeds the result of a finished puzzle back into the vocabulary.
 *
 * One UPDATE per word — they all move to different levels and dates — but sent
 * as a single batch, which Neon runs as one transaction in one round trip.
 * Entries whose word was deleted meanwhile are skipped (`word_id` is nullable
 * exactly so history survives a deletion), and so is the free word of an easy
 * puzzle: it was handed over, not practised, so its schedule stays as it was.
 */
async function applyLearningOutcomes(
  userId: string,
  entries: CrosswordEntry[],
  givens: GivenCell[],
): Promise<void> {
  const wordIds = entries
    .map((entry) => entry.wordId)
    .filter((id): id is string => id !== null);
  if (wordIds.length === 0) return;

  const rows = await db
    .select()
    .from(words)
    .where(and(eq(words.userId, userId), inArray(words.id, wordIds)));

  const byId = new Map(rows.map((word) => [word.id, word]));
  const now = Date.now();
  const timestamp = new Date();

  const updates = entries.flatMap((entry) => {
    const word = entry.wordId ? byId.get(entry.wordId) : undefined;
    if (!word) return [];

    const outcome = entryOutcome(entry, givens);
    if (outcome === "skipped") return [];

    return [
      db
        .update(words)
        .set({ ...applyOutcome(word, outcome, now), updatedAt: timestamp })
        .where(eq(words.id, word.id)),
    ];
  });

  if (updates.length === 0) return;
  await db.batch(updates as [(typeof updates)[number], ...(typeof updates)[number][]]);
}

export async function completeCrossword(userId: string, crosswordId: string): Promise<void> {
  const current = await getCrosswordById(userId, crosswordId);
  if (!current) throw new Error("Crossword não encontrado.");
  if (current.crossword.status === "completed") return;

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

  await applyLearningOutcomes(userId, current.entries, current.crossword.givens);
}

/**
 * Bumps the hint counter of every entry a reveal touched.
 *
 * A revealed cell belongs to up to two words, and it helps both of them, so
 * both are charged for it.
 */
export async function recordReveal(
  crosswordId: string,
  entries: CrosswordEntry[],
  cells: RevealCells,
): Promise<void> {
  const charge = new Map<string, number>();
  for (const [row, col] of cells) {
    for (const entry of entries) {
      if (!entryCovers(entry, row, col)) continue;
      charge.set(entry.id, (charge.get(entry.id) ?? 0) + 1);
    }
  }

  const updates = [...charge].map(([entryId, amount]) =>
    db
      .update(crosswordEntries)
      .set({ revealedCount: sql`${crosswordEntries.revealedCount} + ${amount}` })
      .where(and(eq(crosswordEntries.id, entryId), eq(crosswordEntries.crosswordId, crosswordId))),
  );

  if (updates.length === 0) return;
  await db.batch(updates as [(typeof updates)[number], ...(typeof updates)[number][]]);
}

/** Marks the entries a check caught fully filled in and wrong. */
export async function recordWrongChecks(
  crosswordId: string,
  entryIds: string[],
): Promise<void> {
  if (entryIds.length === 0) return;
  await db
    .update(crosswordEntries)
    .set({ wrongChecks: sql`${crosswordEntries.wrongChecks} + 1` })
    .where(
      and(
        eq(crosswordEntries.crosswordId, crosswordId),
        inArray(crosswordEntries.id, entryIds),
      ),
    );
}

export async function deleteCrossword(userId: string, crosswordId: string): Promise<void> {
  await db
    .delete(crosswords)
    .where(and(eq(crosswords.id, crosswordId), eq(crosswords.userId, userId)));
}
