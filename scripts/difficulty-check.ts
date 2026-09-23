/**
 * Exercises the difficulty levels: which letters start on the board.
 *
 * Pure functions, no database and no network.
 *   mise run test:difficulty
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import { countGiven, pickGivens, type Difficulty } from "../src/lib/crossword/difficulty";
import { generateLayout } from "../src/lib/crossword/generator";
import { createRng } from "../src/lib/crossword/random";
import type { GeneratedLayout } from "../src/lib/crossword/types";
import { isGridUsable, parseWordList } from "../src/lib/words";

let checks = 0;
function check(label: string, run: () => void) {
  run();
  checks += 1;
  console.log(`  ✓ ${label}`);
}

const parsed = parseWordList(
  readFileSync(new URL("../data/seed-words.txt", import.meta.url), "utf8"),
);
const vocabulary = parsed.words
  .filter((word) => isGridUsable(word.answer))
  .map((word, index) => ({
    id: String(index),
    term: word.term,
    answer: word.answer,
    translation: word.translation,
    level: index % 6,
    tier: "simple" as const,
  }));

const RUNS = 120;
const layouts: GeneratedLayout[] = Array.from({ length: RUNS }, (_, run) =>
  generateLayout(vocabulary, { seed: 1000 + run }),
);

type Stats = { share: number; perWord: number[]; full: number; untouched: number };

function measure(layout: GeneratedLayout, difficulty: Difficulty, seed: number): Stats {
  const { cells, freeEntry } = pickGivens(layout.entries, difficulty, createRng(seed));
  const total = layout.grid.flat().filter((cell) => cell !== null).length;

  const unique = new Set(cells.map(([row, col]) => `${row},${col}`));
  assert.equal(unique.size, cells.length, "célula dada repetida");
  for (const [row, col] of cells) {
    assert.ok(layout.grid[row]?.[col], `célula dada fora do grid: ${row},${col}`);
  }

  const perWord = layout.entries.map(
    (entry) => countGiven(entry, cells) / entry.answer.length,
  );
  const full = layout.entries.filter((entry) => countGiven(entry, cells) === entry.answer.length);
  if (freeEntry) assert.ok(full.includes(freeEntry), "a palavra grátis não saiu completa");

  return {
    share: cells.length / total,
    perWord: layout.entries
      .filter((entry) => entry !== freeEntry)
      .map((entry) => countGiven(entry, cells) / entry.answer.length),
    full: full.length,
    untouched: perWord.filter((value) => value === 0).length,
  };
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/* ------------------------------------------------------------------ */
console.log(`\ndifícil (${RUNS} layouts)`);

check("nenhuma letra dada", () => {
  layouts.forEach((layout, run) => {
    const { cells, freeEntry } = pickGivens(layout.entries, "hard", createRng(run));
    assert.equal(cells.length, 0);
    assert.equal(freeEntry, null);
  });
});

/* ------------------------------------------------------------------ */
console.log(`\nmédio (${RUNS} layouts)`);

const medium = layouts.map((layout, run) => measure(layout, "medium", run));

check("nenhuma palavra vem completa", () => {
  for (const stats of medium) assert.equal(stats.full, 0);
});

check("nenhuma palavra passa de 40% dada", () => {
  for (const stats of medium) {
    for (const share of stats.perWord) assert.ok(share <= 0.4 + 1e-9, `palavra com ${share}`);
  }
});

const mediumShare = average(medium.map((stats) => stats.share));
check(`≈25% das casas dadas (média ${(mediumShare * 100).toFixed(1)}%)`, () => {
  assert.ok(mediumShare > 0.18 && mediumShare < 0.3);
});

/* ------------------------------------------------------------------ */
console.log(`\nfácil (${RUNS} layouts)`);

const easy = layouts.map((layout, run) => measure(layout, "easy", run));

check("exatamente uma palavra vem 100% preenchida", () => {
  for (const stats of easy) assert.equal(stats.full, 1);
});

check("todas as outras palavras guardam ao menos uma casa vazia (≤ 60% dada)", () => {
  for (const stats of easy) {
    for (const share of stats.perWord) assert.ok(share <= 0.6 + 1e-9, `palavra com ${share}`);
  }
});

const easyShare = average(easy.map((stats) => stats.share));
check(`≈45% das casas dadas (média ${(easyShare * 100).toFixed(1)}%)`, () => {
  assert.ok(easyShare > 0.38 && easyShare < 0.52);
});

const untouchedEasy = average(easy.map((stats) => stats.untouched));
check(`as letras se espalham: ${untouchedEasy.toFixed(2)} palavra(s) sem nenhuma letra por grid`, () => {
  assert.ok(untouchedEasy < 0.5);
});

check("fácil > médio > difícil em letras dadas, grid a grid", () => {
  easy.forEach((stats, index) => assert.ok(stats.share > medium[index].share));
});

/* ------------------------------------------------------------------ */
console.log("\nescolha da palavra grátis");

check("é uma das palavras com mais cruzamentos", () => {
  layouts.forEach((layout, run) => {
    const { cells, freeEntry } = pickGivens(layout.entries, "easy", createRng(run));
    assert.ok(freeEntry);
    const occupancy = new Map<string, number>();
    for (const entry of layout.entries) {
      const dr = entry.direction === "down" ? 1 : 0;
      const dc = entry.direction === "across" ? 1 : 0;
      for (let i = 0; i < entry.answer.length; i += 1) {
        const key = `${entry.row + dr * i},${entry.col + dc * i}`;
        occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
      }
    }
    const crossings = (entry: (typeof layout.entries)[number]) => {
      const dr = entry.direction === "down" ? 1 : 0;
      const dc = entry.direction === "across" ? 1 : 0;
      let total = 0;
      for (let i = 0; i < entry.answer.length; i += 1) {
        if ((occupancy.get(`${entry.row + dr * i},${entry.col + dc * i}`) ?? 0) > 1) total += 1;
      }
      return total;
    };
    const best = Math.max(...layout.entries.map(crossings));
    assert.equal(crossings(freeEntry), best);
    assert.ok(cells.length > 0);
  });
});

check("mesma semente → mesmas letras (reprodutível)", () => {
  const layout = layouts[0];
  const a = pickGivens(layout.entries, "easy", createRng(42)).cells;
  const b = pickGivens(layout.entries, "easy", createRng(42)).cells;
  assert.deepEqual(a, b);
});

/* ------------------------------------------------------------------ */
console.log(`\n✓ ${checks} verificações passaram\n`);
