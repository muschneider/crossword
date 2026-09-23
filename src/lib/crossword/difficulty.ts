/**
 * Puzzle difficulty: how many letters are already on the board when it starts.
 *
 * Pure and client-safe — the difficulty picker imports the labels from here,
 * and `scripts/difficulty-check.ts` exercises `pickGivens` without a database.
 */
import { shuffle } from "./random";
import type { Direction } from "./types";

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export const DEFAULT_DIFFICULTY: Difficulty = "medium";

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Fácil",
  medium: "Médio",
  hard: "Difícil",
};

export const DIFFICULTY_DESCRIPTIONS: Record<Difficulty, string> = {
  easy: "Bastante letras já no grid e uma palavra inteira pronta.",
  medium: "Algumas letras espalhadas para dar a partida.",
  hard: "Grid vazio: só você e as dicas.",
};

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);
}

/** `[row, col]` of a cell whose letter comes pre-filled. */
export type GivenCell = [number, number];

type EntryShape = {
  row: number;
  col: number;
  direction: Direction;
  answer: string;
  /** Leitner level — breaks ties when choosing the free word. */
  level?: number;
};

type Profile = {
  /** Share of all playable cells to pre-fill, the free word included. */
  share: number;
  /** Most of any single word that may come pre-filled (the free word aside). */
  perWord: number;
  /** Hand one whole word over, so the grid has somewhere to start from. */
  freeWord: boolean;
};

/**
 * `perWord` below 1 is what guarantees every word except the free one keeps at
 * least one empty cell — `floor(length × 0.6)` is at most `length − 1` for any
 * length the grid accepts.
 */
const PROFILES: Record<Difficulty, Profile> = {
  easy: { share: 0.45, perWord: 0.6, freeWord: true },
  medium: { share: 0.25, perWord: 0.4, freeWord: false },
  hard: { share: 0, perWord: 0, freeWord: false },
};

const cellKey = (row: number, col: number) => `${row},${col}`;

export function cellsOf(entry: Pick<EntryShape, "row" | "col" | "direction" | "answer">): GivenCell[] {
  const dr = entry.direction === "down" ? 1 : 0;
  const dc = entry.direction === "across" ? 1 : 0;
  return Array.from(
    { length: entry.answer.length },
    (_, i) => [entry.row + dr * i, entry.col + dc * i] as GivenCell,
  );
}

/** How many of the entry's cells came pre-filled. */
export function countGiven(
  entry: Pick<EntryShape, "row" | "col" | "direction" | "answer">,
  givens: Iterable<GivenCell>,
): number {
  const set = new Set<string>();
  for (const [row, col] of givens) set.add(cellKey(row, col));
  return cellsOf(entry).filter(([row, col]) => set.has(cellKey(row, col))).length;
}

export type GivenSelection<T> = {
  cells: GivenCell[];
  /** The word handed over complete (easy only). */
  freeEntry: T | null;
};

/**
 * Chooses the cells that start filled in.
 *
 * - The free word (easy only) is the one with the most crossings: each crossing
 *   hands a letter to another word, so it is the most useful to give away.
 *   Among those, the best-known word goes first — it is the one that least
 *   needs the practice.
 * - The rest is dealt round-robin, neediest word first, so the letters spread
 *   across the board instead of piling up on a few words. A cell counts
 *   towards every word that crosses it, and no word may pass its cap.
 */
export function pickGivens<T extends EntryShape>(
  entries: readonly T[],
  difficulty: Difficulty,
  rng: () => number,
): GivenSelection<T> {
  const profile = PROFILES[difficulty];
  if (profile.share <= 0 || entries.length === 0) return { cells: [], freeEntry: null };

  const owners = new Map<string, number[]>();
  const cells = entries.map((entry) => cellsOf(entry));
  cells.forEach((list, index) => {
    for (const [row, col] of list) {
      const key = cellKey(row, col);
      const current = owners.get(key);
      if (current) current.push(index);
      else owners.set(key, [index]);
    }
  });

  const target = Math.round(owners.size * profile.share);
  const given = new Set<string>();
  const givenPerEntry = entries.map(() => 0);

  const give = (key: string) => {
    given.add(key);
    for (const owner of owners.get(key) ?? []) givenPerEntry[owner] += 1;
  };

  let freeIndex = -1;
  if (profile.freeWord) {
    const crossings = cells.map(
      (list) => list.filter(([row, col]) => (owners.get(cellKey(row, col))?.length ?? 0) > 1).length,
    );
    const ranked = shuffle(
      entries.map((_, index) => index),
      rng,
    ).sort(
      (a, b) =>
        crossings[b] - crossings[a] ||
        (entries[b].level ?? 0) - (entries[a].level ?? 0) ||
        entries[b].answer.length - entries[a].answer.length,
    );
    freeIndex = ranked[0];
    for (const [row, col] of cells[freeIndex]) give(cellKey(row, col));
  }

  const cap = entries.map((entry, index) =>
    index === freeIndex ? entry.answer.length : Math.floor(entry.answer.length * profile.perWord),
  );
  const fits = (key: string) =>
    (owners.get(key) ?? []).every((owner) => givenPerEntry[owner] < cap[owner]);

  let progressed = true;
  while (given.size < target && progressed) {
    progressed = false;

    // Stable sort over a shuffled order: ties are broken at random.
    const order = shuffle(
      entries.map((_, index) => index),
      rng,
    ).sort(
      (a, b) =>
        givenPerEntry[a] / entries[a].answer.length - givenPerEntry[b] / entries[b].answer.length,
    );

    for (const index of order) {
      if (given.size >= target) break;
      if (index === freeIndex || givenPerEntry[index] >= cap[index]) continue;

      const options = cells[index]
        .map(([row, col]) => cellKey(row, col))
        .filter((key) => !given.has(key) && fits(key));
      if (options.length === 0) continue;

      give(options[Math.floor(rng() * options.length)]);
      progressed = true;
    }
  }

  return {
    cells: [...given].map((key) => key.split(",").map(Number) as GivenCell),
    freeEntry: freeIndex >= 0 ? entries[freeIndex] : null,
  };
}
