import type { ClueSource } from "@/db/schema";
import { generateClueSentences } from "@/lib/openrouter";
import { shuffle } from "./random";
import type { PlacedWord } from "./types";

export type BuiltClue = {
  clue: string;
  clueSource: ClueSource;
};

/**
 * Mixes the two clue styles requested for the puzzle:
 *  - `translation`: the Portuguese meaning the user typed;
 *  - `ai`: an English fill-in-the-blank sentence produced by OpenRouter.
 *
 * AI failures degrade silently to the translation clue, so a puzzle is always
 * generated even when OpenRouter is down or the key is missing.
 */
export async function buildClues(
  entries: PlacedWord[],
  aiRatio: number,
  rng: () => number,
): Promise<Map<string, BuiltClue>> {
  const clues = new Map<string, BuiltClue>();

  const aiCount = Math.round(entries.length * Math.min(Math.max(aiRatio, 0), 1));
  const aiTargets = shuffle(entries, rng).slice(0, aiCount);

  const sentences =
    aiTargets.length > 0
      ? await generateClueSentences(
          aiTargets.map((entry) => ({ term: entry.term, translation: entry.translation })),
        )
      : new Map<string, string>();

  for (const entry of entries) {
    const sentence = sentences.get(entry.term);
    clues.set(
      entry.id,
      sentence
        ? { clue: sentence, clueSource: "ai" }
        : { clue: entry.translation, clueSource: "translation" },
    );
  }

  return clues;
}
