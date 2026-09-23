import type { ClueTier } from "./scheduling";

export type Direction = "across" | "down";

export type GeneratorWord = {
  id: string;
  term: string;
  /** A-Z only, uppercase. */
  answer: string;
  translation: string;
  /** Leitner box of the word, 0..5. */
  level: number;
  /** Clue style this word has earned, derived from `level`. */
  tier: ClueTier;
};

export type PlacedWord = GeneratorWord & {
  row: number;
  col: number;
  direction: Direction;
  number: number;
};

export type GeneratedLayout = {
  width: number;
  height: number;
  /** `null` = blocked cell. */
  grid: (string | null)[][];
  entries: PlacedWord[];
  unplaced: GeneratorWord[];
  intersections: number;
};
