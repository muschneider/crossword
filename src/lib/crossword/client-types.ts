import type { ClueSource, Crossword, CrosswordEntry } from "@/db/schema";
import { enumeration } from "@/lib/words";
import type { Direction } from "./types";

/**
 * What the browser is allowed to see.
 *
 * The solution never leaves the server while a puzzle is active — otherwise the
 * answers would be one devtools inspection away. Checking and revealing are
 * server actions.
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
  /** Only present once the puzzle is finished. */
  answer?: string;
  term?: string;
  translation?: string;
};

export type ClientCrossword = {
  id: string;
  title: string;
  status: "active" | "completed";
  width: number;
  height: number;
  /** `true` = playable cell. */
  mask: boolean[][];
  /** Number shown in the corner of a cell, or 0. */
  numbers: number[][];
  progress: string[][];
  entries: ClientEntry[];
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

  return {
    id: crossword.id,
    title: crossword.title,
    status: crossword.status,
    width: crossword.width,
    height: crossword.height,
    mask: crossword.grid.map((row) => row.map((cell) => cell !== null)),
    numbers: buildNumberGrid(crossword.width, crossword.height, entries),
    progress: crossword.progress,
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
      ...(revealAll
        ? { answer: entry.answer, term: entry.term, translation: entry.translation }
        : {}),
    })),
  };
}
