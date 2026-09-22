/**
 * Exercises the progressive-reveal batching logic (`nextRevealCells`).
 *
 * Pure function, no database: it only needs a grid and an entry.
 *   npx tsx scripts/reveal-check.ts
 */
import "dotenv/config";

import assert from "node:assert/strict";

import type { CrosswordEntry, ProgressGrid } from "../src/db/schema";
import { REVEAL_CLICKS, nextRevealCells } from "../src/lib/crossword/service";

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
console.log("\nconvergência (across e down, comprimentos 2–15)");

for (const direction of ["across", "down"] as const) {
  for (let length = 2; length <= 15; length += 1) {
    const answer = "ABCDEFGHIJKLMNO".slice(0, length);
    const entry: Entry = { row: 2, col: 3, direction, answer };
    const grid = blankGrid();

    let clicks = 0;
    let batch = nextRevealCells(entry, grid);
    while (!batch.complete) {
      assert.ok(batch.cells.length > 0, `${direction}/${length}: clique sem revelar nada`);
      apply(grid, batch.cells);
      clicks += 1;
      assert.ok(clicks <= length, `${direction}/${length}: não converge (${clicks} cliques)`);
      batch = nextRevealCells(entry, grid);
    }
    apply(grid, batch.cells);
    clicks += 1;

    assert.equal(readWord(grid, entry), answer, `${direction}/${length}: palavra final errada`);
    assert.ok(
      clicks <= REVEAL_CLICKS,
      `${direction}/${length}: ${clicks} cliques (esperado ≤ ${REVEAL_CLICKS})`,
    );
  }
}
check(`todas convergem para a palavra inteira em ≤ ${REVEAL_CLICKS} cliques`, () => {});

/* ------------------------------------------------------------------ */
console.log("\ncomportamento por clique");

check("primeiro clique revela um pedaço, não a palavra toda", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const batch = nextRevealCells(entry, blankGrid());
  assert.equal(batch.cells.length, 3, "7 letras / 3 cliques = 3 por clique");
  assert.equal(batch.complete, false);
  assert.equal(batch.revealed, 3);
  assert.equal(batch.total, 7);
});

check("revela da esquerda para a direita", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  apply(grid, nextRevealCells(entry, grid).cells);
  assert.equal(readWord(grid, entry), "MOR....");
});

check("cliques sucessivos avançam até completar", () => {
  const entry: Entry = { row: 1, col: 1, direction: "down", answer: "MORNING" };
  const grid = blankGrid();
  const seen: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    apply(grid, nextRevealCells(entry, grid).cells);
    seen.push(readWord(grid, entry));
  }
  assert.deepEqual(seen, ["MOR....", "MORNIN.", "MORNING"]);
});

check("palavra de 2 letras não revela tudo de uma vez", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "GO" };
  const batch = nextRevealCells(entry, blankGrid());
  assert.equal(batch.cells.length, 1, "mínimo de 1 letra por clique");
  assert.equal(batch.complete, false);
});

/* ------------------------------------------------------------------ */
console.log("\ninteração com o que o jogador digitou");

check("letras corretas já digitadas não são re-reveladas", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  grid[0][0] = "M";
  grid[0][1] = "O";

  const batch = nextRevealCells(entry, grid);
  assert.deepEqual(
    batch.cells.map(([, col]) => col),
    [2, 3, 4],
    "deve pular M e O e seguir do R",
  );
  assert.equal(batch.revealed, 5, "2 digitadas + 3 reveladas");
});

check("letra errada conta como pendente e é corrigida", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  grid[0][0] = "X";

  const batch = nextRevealCells(entry, grid);
  assert.equal(batch.cells[0][2], "M", "a primeira revelada deve corrigir o X");
  apply(grid, batch.cells);
  assert.equal(grid[0][0], "M");
});

check("palavra digitada inteira certa → nada a revelar", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  for (const [i, letter] of [...entry.answer].entries()) grid[0][i] = letter;

  const batch = nextRevealCells(entry, grid);
  assert.deepEqual(batch.cells, []);
  assert.equal(batch.complete, true);
  assert.equal(batch.revealed, batch.total);
});

check("apagar uma letra revelada volta a torná-la pendente", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "MORNING" };
  const grid = blankGrid();
  while (!nextRevealCells(entry, grid).complete) apply(grid, nextRevealCells(entry, grid).cells);
  apply(grid, nextRevealCells(entry, grid).cells);
  assert.equal(readWord(grid, entry), "MORNING");

  grid[0][4] = "";
  const batch = nextRevealCells(entry, grid);
  assert.equal(batch.cells.length, 1);
  assert.deepEqual(batch.cells[0], [0, 4, "I"]);
  assert.equal(batch.complete, true, "só faltava uma letra");
});

check("minúsculas no progresso são tratadas como corretas", () => {
  const entry: Entry = { row: 0, col: 0, direction: "across", answer: "GO" };
  const grid = blankGrid();
  grid[0][0] = "g";
  const batch = nextRevealCells(entry, grid);
  assert.deepEqual(batch.cells, [[0, 1, "O"]]);
  assert.equal(batch.complete, true);
});

/* ------------------------------------------------------------------ */
console.log(`\n✓ ${checks} verificações passaram\n`);
