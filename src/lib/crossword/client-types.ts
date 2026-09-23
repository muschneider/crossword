import type { ClueSource, Crossword, CrosswordEntry } from "@/db/schema";
import { enumeration } from "@/lib/words";
import { countGiven, type Difficulty } from "./difficulty";
import type { Direction } from "./types";

/**
 * What the browser is allowed to see.
 *
 * The solution never leaves the server while a puzzle is active — otherwise the
 * answers would be one devtools inspection away. Checking and revealing are
 * server actions. The same goes for the Portuguese meanings: each one is
 * fetched on demand, so the server knows which words needed it.
 */
export type ClientEntry = {
  id: string;
  number: number;
  direction: Direction;
  row: number;
  col: number;
  length: number;
  clue: string;
  clueSource: ClueSource;
  /** e.g. `(2,3,2,1,4)` for `as far as I know`; empty for single words. */
  enumeration: string;
  /** Every letter came pre-filled: the free word of an easy puzzle. */
  given: boolean;
  /** Portuguese meaning — once the puzzle is over, or once it was looked up. */
  translation?: string;
  /** Only present once the puzzle is finished. */
  answer?: string;
  term?: string;
  /** Letters handed out by the hint button, revealed with the answers. */
  revealedCount?: number;
};

export type ClientCrossword = {
  id: string;
  title: string;
  status: "active" | "completed";
  difficulty: Difficulty;
  width: number;
  height: number;
  /** `true` = playable cell. */
  mask: boolean[][];
  /** `true` = the letter came pre-filled and cannot be changed. */
  givens: boolean[][];
  /** Number shown in the corner of a cell, or 0. */
  numbers: number[][];
  progress: string[][];
  entries: ClientEntry[];
  /** Seconds already spent on this puzzle; the client clock resumes from here. */
  secondsPlayed: number;
  createdAt: string;
  completedAt: string | null;
};

export function buildNumberGrid(
  width: number,
  height: number,
  entries: Pick<CrosswordEntry, "row" | "col" | "number">[],
): number[][] {
  const numbers: number[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 0),
  );
  for (const entry of entries) {
    numbers[entry.row][entry.col] = entry.number;
  }
  return numbers;
}

export function toClientCrossword(
  crossword: Crossword,
  entries: CrosswordEntry[],
): ClientCrossword {
  const revealAll = crossword.status === "completed";
  const givens = crossword.givens ?? [];

  const givenMask = crossword.grid.map((row) => row.map(() => false));
  for (const [row, col] of givens) {
    if (givenMask[row]?.[col] !== undefined) givenMask[row][col] = true;
  }

  return {
    id: crossword.id,
    title: crossword.title,
    status: crossword.status,
    difficulty: crossword.difficulty,
    width: crossword.width,
    height: crossword.height,
    mask: crossword.grid.map((row) => row.map((cell) => cell !== null)),
    givens: givenMask,
    numbers: buildNumberGrid(crossword.width, crossword.height, entries),
    progress: crossword.progress,
    secondsPlayed: crossword.secondsPlayed,
    createdAt: crossword.createdAt.toISOString(),
    completedAt: crossword.completedAt?.toISOString() ?? null,
    entries: entries.map((entry) => ({
      id: entry.id,
      number: entry.number,
      direction: entry.direction,
      row: entry.row,
      col: entry.col,
      length: entry.answer.length,
      clue: entry.clue,
      clueSource: entry.clueSource,
      enumeration: enumeration(entry.term),
      given: givens.length > 0 && countGiven(entry, givens) === entry.answer.length,
      ...(revealAll || entry.usedTranslation ? { translation: entry.translation } : {}),
      ...(revealAll
        ? {
            answer: entry.answer,
            term: entry.term,
            revealedCount: entry.revealedCount,
          }
        : {}),
    })),
  };
}
