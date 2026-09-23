import type { Word } from "@/db/schema";
import { isGridUsable } from "@/lib/words";
import { shuffle, weightedSample } from "./random";
import { clueTierFor, rotationWeight } from "./scheduling";
import type { GeneratorWord } from "./types";

export { rotationWeight } from "./scheduling";

export type Selection = {
  /** Words handed to the layout engine. */
  chosen: GeneratorWord[];
  /** Everything that was eligible (used to retry with another subset). */
  pool: GeneratorWord[];
};

export type SelectOptions = {
  targetWords: number;
  poolSize: number;
  rng: () => number;
  now?: number;
};

export function toGeneratorWord(word: Word): GeneratorWord {
  return {
    id: word.id,
    term: word.term,
    answer: word.answer,
    translation: word.translation,
    level: word.level,
    tier: clueTierFor(word.level),
  };
}

/**
 * How many words of 6+ letters a subset should carry.
 *
 * The layout engine seeds the board with its longest word and grows outward, so
 * a subset of only short words produces a cramped grid with few crossings. Two
 * long anchors is the sweet spot found while tuning `try:generator`.
 */
const LONG_WORD_TARGET = 2;
const LONG_WORD_LENGTH = 6;

type Band = "new" | "struggling" | "review";

function bandOf(word: Word): Band {
  if (word.usageCount === 0) return "new";
  return word.level <= 1 ? "struggling" : "review";
}

/**
 * Share of a puzzle any single band may occupy.
 *
 * Weighting alone is not enough. A learner with 20 words they keep getting
 * wrong generates 20 reviews a day against 12 slots: the struggling band would
 * swallow every puzzle and the rest of the vocabulary would never circulate
 * again — and would therefore never climb to the harder clue tiers. The same
 * happens on the other end with a freshly imported list, where hundreds of
 * brand-new words would crowd out every review until the list ran out.
 *
 * Capping both bands at half a puzzle is the same thing Anki does with its
 * new/review daily limits, and it is what makes a session feel like study
 * instead of punishment. Quotas are a ceiling, never a floor: when a band
 * cannot be filled, the leftovers take the empty seats.
 */
const BAND_SHARE = 0.5;

/**
 * Builds the subset actually handed to the layout engine.
 *
 * Walks the pool in weight order — that is the spaced-repetition ranking —
 * honouring the per-band quotas, then fills any shortfall with what was skipped
 * and finally guarantees a couple of long anchors for the grid.
 */
function buildSubset(pool: Word[], targetWords: number): Word[] {
  const size = Math.min(targetWords, pool.length);
  const cap = Math.max(1, Math.ceil(size * BAND_SHARE));
  const quota: Record<Band, number> = { new: cap, struggling: cap, review: size };

  const chosen: Word[] = [];
  const skipped: Word[] = [];

  for (const word of pool) {
    if (chosen.length >= size) {
      skipped.push(word);
      continue;
    }
    const band = bandOf(word);
    if (quota[band] > 0) {
      quota[band] -= 1;
      chosen.push(word);
    } else {
      skipped.push(word);
    }
  }

  for (const word of skipped) {
    if (chosen.length >= size) break;
    chosen.push(word);
  }

  const rest = skipped.filter((word) => !chosen.includes(word));
  const isLong = (word: Word) => word.answer.length >= LONG_WORD_LENGTH;
  let missing = LONG_WORD_TARGET - chosen.filter(isLong).length;

  // Replace from the tail of the subset: those are the lowest-priority picks.
  for (let i = chosen.length - 1; i >= 0 && missing > 0; i -= 1) {
    if (isLong(chosen[i])) continue;
    const replacementIndex = rest.findIndex(isLong);
    if (replacementIndex === -1) break;
    chosen[i] = rest.splice(replacementIndex, 1)[0];
    missing -= 1;
  }

  return chosen;
}

export function selectWords(words: Word[], options: SelectOptions): Selection {
  const eligible = words.filter((word) => isGridUsable(word.answer));

  if (eligible.length < 4) {
    throw new Error(
      `São necessárias pelo menos 4 palavras com 3 a 15 letras para gerar um crossword. ` +
        `Você tem ${eligible.length}.`,
    );
  }

  const now = options.now ?? Date.now();
  const poolSize = Math.min(Math.max(options.poolSize, options.targetWords * 2), eligible.length);

  const pool = weightedSample(eligible, (word) => rotationWeight(word, now), poolSize, options.rng);
  const chosen = buildSubset(pool, options.targetWords);

  return {
    chosen: shuffle(chosen, options.rng).map(toGeneratorWord),
    pool: pool.map(toGeneratorWord),
  };
}

/** Builds an alternative subset from the same pool (used when a layout is poor). */
export function resample(pool: GeneratorWord[], targetWords: number, rng: () => number) {
  return shuffle(pool, rng).slice(0, Math.min(targetWords, pool.length));
}
