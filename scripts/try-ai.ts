/**
 * Smoke test for the OpenRouter clue generator.
 *   mise run try:ai
 */
import "dotenv/config";

import { generateClueSentences } from "../src/lib/openrouter";

const items = [
  { term: "accomplish", translation: "realizar / alcançar / cumprir / concluir" },
  { term: "afraid", translation: "com medo / assustado" },
  { term: "as far as I know", translation: "pelo que eu sei" },
  { term: "at least", translation: "pelo menos" },
  { term: "annoying", translation: "irritante / chato" },
];

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY não configurada.");
    process.exit(1);
  }

  console.log(`Modelo: ${process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini"}`);
  const started = Date.now();
  const clues = await generateClueSentences(items);
  console.log(`Resposta em ${Date.now() - started}ms\n`);

  for (const item of items) {
    const clue = clues.get(item.term);
    console.log(clue ? `✓ ${item.term}\n    ${clue}` : `✗ ${item.term} (fallback: ${item.translation})`);
  }
  console.log(`\n${clues.size}/${items.length} dicas geradas pela IA.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
