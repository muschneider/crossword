import type { ClueSource } from "@/db/schema";
import { generateClues, type ClueRequest } from "./ai-clues";
import type { PlacedWord } from "./types";

export type BuiltClue = {
  clue: string;
  clueSource: ClueSource;
};

/** Meanings beyond this many are noise in a clue list. */
const MAX_SENSES = 3;

/**
 * Turns the raw translation field into something that reads like a clue.
 *
 * `realizar / alcançar / cumprir / concluir` → `Realizar; alcançar; cumprir`
 *
 * Only used as the last-resort clue, when the AI returned nothing usable.
 */
export function formatTranslationClue(translation: string): string {
  const senses = translation
    .split(/\s*[/;|]\s*|\s*,\s*/)
    .map((sense) => sense.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (senses.length === 0) return translation.trim();

  const kept = senses.slice(0, MAX_SENSES).join("; ");
  return kept.charAt(0).toUpperCase() + kept.slice(1);
}

export type BuildCluesOptions = {
  /** Clues each word (by word id) already had, so the new one is different. */
  avoid?: Map<string, string[]>;
  /** Time budget for the AI, in milliseconds. */
  budgetMs?: number;
};

export type BuildCluesResult = {
  /** Keyed by the entry's word id. */
  clues: Map<string, BuiltClue>;
  /** Entries left with the Portuguese meaning because the AI had nothing. */
  fallbacks: number;
};

/**
 * Writes one English clue per entry, at the difficulty each word has earned.
 *
 * The style comes from the word's Leitner level (see `scheduling.ts`): a plain
 * explanation with a helping hand while it is being learned, a dictionary
 * definition once it is getting solid, a terse crossword clue once mastered.
 * A puzzle therefore mixes difficulties by itself, without any random split.
 *
 * The Portuguese meaning is never the clue unless the AI is down or returned
 * nothing usable for a word; the player has a button to see it instead.
 */
export async function buildClues(
  entries: PlacedWord[],
  options: BuildCluesOptions = {},
): Promise<BuildCluesResult> {
  const requests: ClueRequest[] = entries.map((entry) => ({
    key: entry.id,
    term: entry.term,
    translation: entry.translation,
    style: entry.tier,
    avoid: options.avoid?.get(entry.id),
  }));

  const generated = await generateClues(requests, { budgetMs: options.budgetMs });

  const clues = new Map<string, BuiltClue>();
  let fallbacks = 0;

  for (const entry of entries) {
    const ai = generated.get(entry.id);
    if (ai) {
      clues.set(entry.id, { clue: ai.text, clueSource: ai.style });
    } else {
      fallbacks += 1;
      clues.set(entry.id, {
        clue: formatTranslationClue(entry.translation),
        clueSource: "translation",
      });
    }
  }

  return { clues, fallbacks };
}
