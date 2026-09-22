import type { Word } from "@/db/schema";
import { isGridUsable } from "@/lib/words";
import { shuffle, weightedSample } from "./random";
import type { GeneratorWord } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rotation weight.
 *
 * Words that were never used are strongly preferred; each extra use decays the
 * weight, and the weight slowly recovers as time passes. The result is that a
 * large vocabulary gets covered evenly instead of the same 10 words showing up
 * in every puzzle.
 */
export function rotationWeight(word: Word, now = Date.now()): number {
  const usagePenalty = 1 / Math.pow(word.usageCount + 1, 1.8);

  if (!word.lastUsedAt) return usagePenalty * 4;

  const days = Math.max(0, (now - word.lastUsedAt.getTime()) / DAY_MS);
  const recency = Math.min(1 + days / 5, 4);
  return usagePenalty * recency;
}

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
  };
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

  const target = Math.min(options.targetWords, pool.length);
  const chosen = pool.slice(0, target);

  // A long word makes a much better seed for the layout; make sure the subset
  // has at least one if the pool can offer it.
  const hasLong = chosen.some((word) => word.answer.length >= 6);
  if (!hasLong) {
    const longFromPool = pool.slice(target).find((word) => word.answer.length >= 6);
    if (longFromPool) chosen[chosen.length - 1] = longFromPool;
  }

  return {
    chosen: shuffle(chosen, options.rng).map(toGeneratorWord),
    pool: pool.map(toGeneratorWord),
  };
}

/** Builds an alternative subset from the same pool (used when a layout is poor). */
export function resample(pool: GeneratorWord[], targetWords: number, rng: () => number) {
  return shuffle(pool, rng).slice(0, Math.min(targetWords, pool.length));
}
