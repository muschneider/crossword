/**
 * Offline smoke test for the layout engine — no DB, no network.
 *   mise run try:generator
 */
import { readFileSync } from "node:fs";

import { generateLayout } from "../src/lib/crossword/generator";
import { isGridUsable, parseWordList, enumeration } from "../src/lib/words";

const input = readFileSync(new URL("../data/seed-words.txt", import.meta.url), "utf8");
const parsed = parseWordList(input);

console.log(`Parsed ${parsed.words.length} words, ${parsed.issues.length} issues.`);
for (const issue of parsed.issues) {
  console.log(`  ! line ${issue.line}: ${issue.reason} -> ${issue.content}`);
}

const usable = parsed.words
  .filter((word) => isGridUsable(word.answer))
  .map((word, index) => ({
    id: String(index),
    term: word.term,
    answer: word.answer,
    translation: word.translation,
    level: 0,
    tier: "simple" as const,
  }));

console.log(`\n${usable.length} usable in a grid.\n`);

for (let run = 1; run <= 3; run += 1) {
  const layout = generateLayout(usable);
  console.log(
    `--- run ${run}: ${layout.entries.length}/${usable.length} placed, ` +
      `${layout.width}x${layout.height}, ${layout.intersections} intersections ---`,
  );

  for (const row of layout.grid) {
    console.log(row.map((cell) => cell ?? ".").join(" "));
  }

  console.log();
  for (const entry of layout.entries) {
    console.log(
      `  ${String(entry.number).padStart(2)}${entry.direction === "across" ? "A" : "D"} ` +
        `${entry.term} ${enumeration(entry.term)} = ${entry.translation}`,
    );
  }
  if (layout.unplaced.length > 0) {
    console.log(`  unplaced: ${layout.unplaced.map((word) => word.term).join(", ")}`);
  }
  console.log();
}
