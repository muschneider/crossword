/** Small, fast, seedable PRNG (mulberry32) so layouts are reproducible in tests. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Fisher-Yates — returns a new array, leaves the input untouched. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function pickOne<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

/**
 * Weighted sampling without replacement (Efraimidis-Spirakis):
 * each item gets key = rng^(1/weight); the top-k keys are the sample.
 */
export function weightedSample<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  size: number,
  rng: () => number,
): T[] {
  return items
    .map((item) => {
      const weight = Math.max(weightOf(item), 1e-9);
      return { item, key: Math.pow(rng(), 1 / weight) };
    })
    .sort((a, b) => b.key - a.key)
    .slice(0, size)
    .map((entry) => entry.item);
}
