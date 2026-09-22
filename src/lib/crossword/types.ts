export type Direction = "across" | "down";

export type GeneratorWord = {
  id: string;
  term: string;
  /** A-Z only, uppercase. */
  answer: string;
  translation: string;
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
