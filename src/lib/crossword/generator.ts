import { createRng, pickOne, randomSeed, shuffle } from "./random";
import type { Direction, GeneratedLayout, GeneratorWord, PlacedWord } from "./types";

type Placement = {
  word: GeneratorWord;
  row: number;
  col: number;
  direction: Direction;
};

type Candidate = Placement & {
  intersections: number;
  score: number;
};

const cellKey = (row: number, col: number) => `${row},${col}`;

/**
 * Free-form ("criss-cross") builder.
 *
 * Invariants enforced on every placement:
 *  1. overlapping cells must carry the same letter;
 *  2. the cells immediately before/after the word are empty, so words never
 *     run into each other;
 *  3. a *newly created* cell must have both perpendicular neighbours empty.
 *
 * Together these guarantee that the only readable runs of 2+ letters in the
 * final grid are exactly the placed words — no accidental garbage entries.
 */
class Board {
  private readonly cells = new Map<string, string>();
  readonly placements: Placement[] = [];

  minRow = 0;
  maxRow = 0;
  minCol = 0;
  maxCol = 0;

  private letterAt(row: number, col: number): string | undefined {
    return this.cells.get(cellKey(row, col));
  }

  get width(): number {
    return this.placements.length === 0 ? 0 : this.maxCol - this.minCol + 1;
  }

  get height(): number {
    return this.placements.length === 0 ? 0 : this.maxRow - this.minRow + 1;
  }

  /** Returns the number of intersections, or `null` when the placement is illegal. */
  evaluate(answer: string, row: number, col: number, direction: Direction): number | null {
    const dr = direction === "down" ? 1 : 0;
    const dc = direction === "across" ? 1 : 0;

    // Rule 2 — head and tail must be free.
    if (this.letterAt(row - dr, col - dc) !== undefined) return null;
    if (this.letterAt(row + dr * answer.length, col + dc * answer.length) !== undefined) {
      return null;
    }

    let intersections = 0;
    let newCells = 0;

    for (let i = 0; i < answer.length; i += 1) {
      const r = row + dr * i;
      const c = col + dc * i;
      const existing = this.letterAt(r, c);

      if (existing !== undefined) {
        // Rule 1 — letters must agree.
        if (existing !== answer[i]) return null;
        intersections += 1;
        continue;
      }

      // Rule 3 — a brand new cell must not touch anything sideways.
      if (direction === "across") {
        if (this.letterAt(r - 1, c) !== undefined) return null;
        if (this.letterAt(r + 1, c) !== undefined) return null;
      } else {
        if (this.letterAt(r, c - 1) !== undefined) return null;
        if (this.letterAt(r, c + 1) !== undefined) return null;
      }
      newCells += 1;
    }

    // A placement that adds nothing is just a duplicate laid on top of another.
    if (newCells === 0) return null;
    return intersections;
  }

  place(word: GeneratorWord, row: number, col: number, direction: Direction): void {
    const dr = direction === "down" ? 1 : 0;
    const dc = direction === "across" ? 1 : 0;

    for (let i = 0; i < word.answer.length; i += 1) {
      const r = row + dr * i;
      const c = col + dc * i;
      this.cells.set(cellKey(r, c), word.answer[i]);

      if (this.placements.length === 0 && i === 0) {
        this.minRow = this.maxRow = r;
        this.minCol = this.maxCol = c;
      } else {
        if (r < this.minRow) this.minRow = r;
        if (r > this.maxRow) this.maxRow = r;
        if (c < this.minCol) this.minCol = c;
        if (c > this.maxCol) this.maxCol = c;
      }
    }

    this.placements.push({ word, row, col, direction });
  }

  /** Bounding box the grid *would* have if this placement were applied. */
  projectedBox(answer: string, row: number, col: number, direction: Direction) {
    const endRow = direction === "down" ? row + answer.length - 1 : row;
    const endCol = direction === "across" ? col + answer.length - 1 : col;
    const minRow = Math.min(this.minRow, row);
    const maxRow = Math.max(this.maxRow, endRow);
    const minCol = Math.min(this.minCol, col);
    const maxCol = Math.max(this.maxCol, endCol);
    return { width: maxCol - minCol + 1, height: maxRow - minRow + 1 };
  }

  entries(): { word: GeneratorWord; row: number; col: number; direction: Direction }[] {
    return this.placements.map((placement) => ({
      word: placement.word,
      row: placement.row - this.minRow,
      col: placement.col - this.minCol,
      direction: placement.direction,
    }));
  }

  toGrid(): (string | null)[][] {
    const grid: (string | null)[][] = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => null),
    );
    for (const [key, letter] of this.cells) {
      const [r, c] = key.split(",").map(Number);
      grid[r - this.minRow][c - this.minCol] = letter;
    }
    return grid;
  }
}

function findCandidates(board: Board, word: GeneratorWord, maxSize: number): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const placement of board.placements) {
    const { word: anchor } = placement;
    const dr = placement.direction === "down" ? 1 : 0;
    const dc = placement.direction === "across" ? 1 : 0;
    // A new word always crosses an existing one perpendicularly.
    const direction: Direction = placement.direction === "across" ? "down" : "across";

    for (let a = 0; a < anchor.answer.length; a += 1) {
      const anchorRow = placement.row + dr * a;
      const anchorCol = placement.col + dc * a;
      const letter = anchor.answer[a];

      for (let i = 0; i < word.answer.length; i += 1) {
        if (word.answer[i] !== letter) continue;

        const row = direction === "down" ? anchorRow - i : anchorRow;
        const col = direction === "across" ? anchorCol - i : anchorCol;

        const key = `${row},${col},${direction}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const box = board.projectedBox(word.answer, row, col, direction);
        if (box.width > maxSize || box.height > maxSize) continue;

        const intersections = board.evaluate(word.answer, row, col, direction);
        if (intersections === null) continue;

        // Favour many crossings, compact boxes and roughly square grids.
        const area = box.width * box.height;
        const skew = Math.abs(box.width - box.height);
        const score = intersections * 12 - area * 0.06 - skew * 0.8;

        candidates.push({ word, row, col, direction, intersections, score });
      }
    }
  }

  return candidates;
}

function buildAttempt(
  words: GeneratorWord[],
  maxSize: number,
  rng: () => number,
): { board: Board; unplaced: GeneratorWord[]; intersections: number } {
  const board = new Board();
  const queue = shuffle(words, rng);

  // Seed the board with one of the longest words, horizontally.
  const longest = Math.max(...queue.map((word) => word.answer.length));
  const seedPool = queue.filter((word) => word.answer.length >= longest - 1);
  const seedWord = pickOne(seedPool, rng);
  board.place(seedWord, 0, 0, "across");

  let pending = queue.filter((word) => word.id !== seedWord.id);
  let intersections = 0;

  // Several passes: a word that did not fit early on often fits once the
  // board has grown.
  for (let pass = 0; pass < 3 && pending.length > 0; pass += 1) {
    const stillPending: GeneratorWord[] = [];

    for (const word of shuffle(pending, rng)) {
      const candidates = findCandidates(board, word, maxSize);
      if (candidates.length === 0) {
        stillPending.push(word);
        continue;
      }

      candidates.sort((a, b) => b.score - a.score);
      // Pick randomly among the best few so two runs never look alike.
      const topSlice = candidates.slice(0, Math.min(4, candidates.length));
      const chosen = pickOne(topSlice, rng);

      board.place(chosen.word, chosen.row, chosen.col, chosen.direction);
      intersections += chosen.intersections;
    }

    if (stillPending.length === pending.length) {
      pending = stillPending;
      break;
    }
    pending = stillPending;
  }

  return { board, unplaced: pending, intersections };
}

function numberEntries(
  grid: (string | null)[][],
  entries: { word: GeneratorWord; row: number; col: number; direction: Direction }[],
): PlacedWord[] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const numbers = new Map<string, number>();
  let next = 1;

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      if (grid[row][col] === null) continue;

      const startsAcross =
        (col === 0 || grid[row][col - 1] === null) && col + 1 < width && grid[row][col + 1] !== null;
      const startsDown =
        (row === 0 || grid[row - 1][col] === null) &&
        row + 1 < height &&
        grid[row + 1][col] !== null;

      if (startsAcross || startsDown) {
        numbers.set(cellKey(row, col), next);
        next += 1;
      }
    }
  }

  return entries
    .map((entry) => ({
      ...entry.word,
      row: entry.row,
      col: entry.col,
      direction: entry.direction,
      number: numbers.get(cellKey(entry.row, entry.col)) ?? 0,
    }))
    .sort((a, b) => a.number - b.number || a.direction.localeCompare(b.direction));
}

export type GenerateOptions = {
  /** Upper bound for both grid dimensions. */
  maxSize?: number;
  /** How many independent layouts to try before keeping the best. */
  attempts?: number;
  seed?: number;
};

export function generateLayout(
  words: GeneratorWord[],
  options: GenerateOptions = {},
): GeneratedLayout {
  if (words.length === 0) {
    throw new Error("Nenhuma palavra disponível para gerar o crossword.");
  }

  const longest = Math.max(...words.map((word) => word.answer.length));
  const maxSize = Math.max(options.maxSize ?? 17, longest + 1);
  const attempts = options.attempts ?? 14;
  const rng = createRng(options.seed ?? randomSeed());

  let best: { board: Board; unplaced: GeneratorWord[]; intersections: number } | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = buildAttempt(words, maxSize, rng);
    const placed = result.board.placements.length;
    const area = Math.max(result.board.width * result.board.height, 1);
    const density = (result.board.placements.reduce((sum, p) => sum + p.word.answer.length, 0) -
      result.intersections) / area;

    const score = placed * 100 + result.intersections * 10 + density * 40;

    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
    // Everything placed with a healthy number of crossings: good enough.
    if (result.unplaced.length === 0 && result.intersections >= placed - 1) break;
  }

  const { board, unplaced, intersections } = best!;
  const grid = board.toGrid();

  return {
    width: board.width,
    height: board.height,
    grid,
    entries: numberEntries(grid, board.entries()),
    unplaced,
    intersections,
  };
}

