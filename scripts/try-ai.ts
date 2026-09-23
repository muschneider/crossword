/**
 * Runs the real clue pipeline (write → filter → blind solve → repair) against
 * OpenRouter and prints every candidate with the solver's guesses.
 *
 *   mise run try:ai
 *   mise run try:ai -- --style=crossword      # force one style for every word
 */
import "dotenv/config";

import { generateClues, type ClueReport, type ClueStyle } from "../src/lib/crossword/ai-clues";

/** Real vocabulary shapes: inflections, phrasal verbs, expressions, typos. */
const WORDS: [string, string, ClueStyle][] = [
  ["pays off", "compensa / vale a pena", "simple"],
  ["cleverest", "mais inteligente / o mais esperto", "simple"],
  ["at least", "pelo menos", "simple"],
  ["annoying", "irritante / chato", "simple"],
  ["actually", "na verdade", "simple"],
  ["as if", "até parece", "simple"],
  ["come to", "vir para", "simple"],
  ["O'clock", "usado para indicar as horas inteiras", "simple"],
  ["wake up", "acordar", "definition"],
  ["fairly", "justamente / razoavelmente / bastante", "definition"],
  ["desire", "desejo / desejar / vontade", "definition"],
  ["besides", "além do mais / além disso", "definition"],
  ["narrow down", "restringir / reduzir / limitar", "definition"],
  ["as far as I know", "pelo que eu sei", "definition"],
  ["breakthrough", "avanço / descoberta importante", "crossword"],
  ["complained", "reclamou", "crossword"],
  ["my bad", "foi mal", "crossword"],
  ["in the meantime", "enquanto isso", "crossword"],
  ["whoose", "de quem", "crossword"],
  ["reliable", "confiável", "crossword"],
];

const forced = process.argv.find((arg) => arg.startsWith("--style="))?.split("=")[1] as
  | ClueStyle
  | undefined;

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY não configurada.");
    process.exit(1);
  }

  console.log(`Modelo: ${process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini"}\n`);

  let report: ClueReport[] = [];
  const started = Date.now();
  const clues = await generateClues(
    WORDS.map(([term, translation, style], index) => ({
      key: String(index),
      term,
      translation,
      style: forced ?? style,
    })),
    { onReport: (value) => (report = value) },
  );
  const elapsed = Date.now() - started;

  for (const word of report) {
    const chosen = clues.get(word.key);
    console.log(`${word.term}  [${word.style}]`);
    for (const candidate of word.candidates) {
      const mark = candidate.text === chosen?.text ? "→" : " ";
      const status = candidate.verified ? "✓" : candidate.guesses ? "✗" : "?";
      const guesses = candidate.guesses ? `  (${candidate.guesses.join(", ") || "sem palpite"})` : "";
      console.log(`  ${mark} ${status} r${candidate.round} ${candidate.text}${guesses}`);
    }
    if (!chosen) console.log("  → sem dica em inglês (cairia para a tradução)");
    console.log();
  }

  const verified = [...clues.values()].filter((clue) => clue.verified).length;
  console.log(
    `${clues.size}/${WORDS.length} com dica em inglês · ${verified} verificadas pelo resolvedor · ${(elapsed / 1000).toFixed(1)}s`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
