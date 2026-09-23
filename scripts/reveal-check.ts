/**
 * Exercises the two reveal modes (`revealLetter` / `revealWord`).
 *
 * Pure functions, no database: they only need a grid and an entry.
 *   mise run test:reveal
 */
import "dotenv/config";

import assert from "node:assert/strict";

import type { CrosswordEntry, ProgressGrid } from "../src/db/schema";
import { revealLetter, revealWord } from "../src/lib/crossword/service";

type Entry = Pick<CrosswordEntry, "row" | "col" | "direction" | "answer">;

const SIZE = 20;

function blankGrid(): ProgressGrid {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ""));
}

function cellsOf(entry: Entry): [number, number][] {
  const dr = entry.direction === "down" ? 1 : 0;
  const dc = entry.direction === "across" ? 1 : 0;
  return Array.from(
    { length: entry.answer.length },
    (_, i) => [entry.row + dr * i, entry.col + dc * i] as [number, number],
  );
}

function readWord(grid: ProgressGrid, entry: Entry): string {
  return cellsOf(entry)
    .map(([row, col]) => grid[row][col] || ".")
    .join("");
}

function apply(grid: ProgressGrid, cells: [number, number, string][]): void {
  for (const [row, col, letter] of cells) grid[row][col] = letter;
}

let checks = 0;
function check(label: string, run: () => void) {
  run();
  checks += 1;
  console.log(`  ✓ ${label}`);
}

/* ------------------------------------------------------------------ */
console.log("\nrevelar palavra (across e down, comprimentos 2–15)");

for (const direction of ["across", "down"] as const) {
  for (let length = 2; length <= 15; length += 1) {
    const answer = "ABCDEFGHIJKLMNO".slice(0, length);
    const entry: Entry = { row: 2, col: 3, direction, answer };
    const grid = blankGrid();

    apply(grid, revealWord(entry, grid));
    assert.equal(readWord(grid, entry), answer, `${direction}/${length}: palavra final errada`);
    assert.deepEqual(revealWord(entry, grid), [], `${direction}/${length}: revelou duas vezes`);
  }
}
check("uma chamada completa a palavra inteira e a seguinte não faz nada", () => {});

/* ------------------------------------------------------------------ */
console.log("\nrevelar letra");

check("sem cursor, revela a primeira casa pendente", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  const cells = revealLetter(entry, grid);
  assert.deepEqual(cells, [[0, 0, "M"]]);
});

check("com cursor, revela exatamente a casa do cursor", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  const cells = revealLetter(entry, grid, { row: 0, col: 4 });
  assert.deepEqual(cells, [[0, 4, "I"]]);
});

check("cursor sobre casa já correta cai na primeira pendente", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  grid[0][4] = "I";
  const cells = revealLetter(entry, grid, { row: 0, col: 4 });
  assert.deepEqual(cells, [[0, 0, "M"]]);
});

check("cliques sucessivos avançam até completar", () => {
  const entry: Entry = { row: 1, col: 1, direction: "down", answer: "GOAL" };
  const grid = blankGrid();
  const seen: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    apply(grid, revealLetter(entry, grid));
    seen.push(readWord(grid, entry));
  }
  assert.deepEqual(seen, ["G...", "GO..", "GOA.", "GOAL"]);
});

/* ------------------------------------------------------------------ */
console.log("\ninteração com o que o jogador digitou");

check("letras corretas já digitadas não são re-reveladas", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  grid[0][0] = "M";
  grid[0][1] = "O";
  assert.deepEqual(revealLetter(entry, grid), [[0, 2, "R"]]);
  assert.deepEqual(
    revealWord(entry, grid).map(([, col]) => col),
    [2, 3, 4, 5, 6],
  );
});

check("letra errada conta como pendente e é corrigida", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  grid[0][0] = "X";
  const cells = revealLetter(entry, grid);
  assert.deepEqual(cells, [[0, 0, "M"]]);
  apply(grid, cells);
  assert.equal(grid[0][0], "M");
});

check("palavra digitada inteira certa → nada a revelar", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  for (const [i, letter] of [...entry.answer].entries()) grid[0][i] = letter;
  assert.deepEqual(revealWord(entry, grid), []);
  assert.deepEqual(revealLetter(entry, grid), []);
});

check("apagar uma letra revelada volta a torná-la pendente", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  apply(grid, revealWord(entry, grid));
  assert.equal(readWord(grid, entry), "MORNING");

  grid[0][4] = "";
  assert.deepEqual(revealWord(entry, grid), [[0, 4, "I"]]);
});

check("minúsculas no progresso são tratadas como corretas", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "GO" };
  const grid = blankGrid();
  grid[0][0] = "g";
  assert.deepEqual(revealWord(entry, grid), [[0, 1, "O"]]);
});

/* ------------------------------------------------------------------ */
console.log(`\n✓ ${checks} verificações passaram\n`);
