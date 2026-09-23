/**
 * Spaced repetition for the vocabulary.
 *
 * Every word carries a Leitner box (`level`, 0..5). Solving a word cleanly
 * promotes it and pushes its next appearance further away; needing a hint
 * demotes it and brings it back almost immediately. The same level also picks
 * how hard the clue is written (see `clueTierFor`), so a word gets *harder to
 * guess* exactly as it gets *rarer to see* — the two axes of difficulty move
 * together instead of being random.
 *
 * Pure functions, no database: `scripts/scheduling-check.ts` exercises them.
 */

export const MIN_LEVEL = 0;
export const MAX_LEVEL = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days until a word at each level is due again.
 *
 * Level 0 is due immediately: a word you just failed should be able to show up
 * in the very next puzzle. From there the spacing roughly doubles, which is the
 * classic Leitner ladder.
 */
export const REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 16, 35] as const;

/** Human label for each box, used across the UI. */
export const LEVEL_LABELS = [
  "nova",
  "aprendendo",
  "aprendendo",
  "firme",
  "firme",
  "dominada",
] as const;

export type ClueTier = "simple" | "definition" | "crossword";

/**
 * How the clue for a word should be written, given how well it is known.
 *
 * Every tier is English: the Portuguese meaning is one button away in the
 * player, never the clue itself. What changes is how much the clue helps.
 *
 *   0-1  simple      plain-English explanation plus one helping hand
 *                    (a common synonym or an everyday situation).
 *   2-3  definition  dictionary-style definition, no crutches.
 *   4-5  crossword   short newspaper-style clue — a synonym or tight paraphrase.
 */
export function clueTierFor(level: number): ClueTier {
  if (level <= 1) return "simple";
  if (level <= 3) return "definition";
  return "crossword";
}

/**
 * How a word behaved inside one puzzle.
 *
 *  - `clean`    produced with no help at all → promote;
 *  - `assisted` no hint used, but the puzzle's difficulty had already given
 *               half of it or more → hold, without counting a miss;
 *  - `shaky`    a wrong attempt, a letter or two handed over, or the Portuguese
 *               meaning looked up before solving → hold, streak reset;
 *  - `failed`   half of what the player had to find was revealed → demote;
 *  - `skipped`  every letter was given (the free word of an easy puzzle) →
 *               not scored at all.
 */
export type WordOutcome = "clean" | "assisted" | "shaky" | "failed" | "skipped";

/** Outcomes that actually move a word on the ladder. */
export type ScoredOutcome = Exclude<WordOutcome, "skipped">;

export type OutcomeInput = {
  /** Letters in the answer. */
  length: number;
  /** Letters handed out by the reveal buttons. */
  revealedCount: number;
  /** Times a check caught the entry complete and wrong. */
  wrongChecks: number;
  /** Letters pre-filled by the puzzle's difficulty. */
  givenCount?: number;
  /** The Portuguese meaning was shown before the word was solved. */
  usedTranslation?: boolean;
};

/**
 * A single revealed letter is not a failure: crossing words share cells, so
 * asking for help on one word inevitably fills a letter of the other. Only
 * needing *half* of what was left to find counts as not knowing it.
 *
 * Letters given by the difficulty setting are not hints — the player did not
 * ask for them — but they do make recall easier, so a word that came mostly
 * pre-filled cannot earn a promotion.
 */
export function classifyOutcome(input: OutcomeInput): WordOutcome {
  const length = Math.max(1, input.length);
  const given = Math.min(Math.max(input.givenCount ?? 0, 0), length);
  if (given >= length) return "skipped";

  const toFind = length - given;
  if (input.revealedCount >= Math.max(2, Math.ceil(toFind / 2))) return "failed";
  if (input.revealedCount > 0 || input.wrongChecks > 0 || input.usedTranslation) return "shaky";
  if (given * 2 >= length) return "assisted";
  return "clean";
}

export type ScheduleInput = {
  level: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  missCount: number;
};

export type ScheduleUpdate = {
  level: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  missCount: number;
  dueAt: Date;
};

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.trunc(level)));
}

export function dueDateFor(level: number, from: number = Date.now()): Date {
  return new Date(from + REVIEW_INTERVAL_DAYS[clampLevel(level)] * DAY_MS);
}

/**
 * Applies one puzzle result to a word.
 *
 * A failure drops two boxes rather than one: getting a word wrong after it was
 * "firme" means the earlier promotions were optimistic, and a single-box demotion
 * would still park it a week away.
 *
 * `assisted` holds the box *and* the streak: the player did nothing wrong, the
 * puzzle simply did not test them enough to justify a promotion.
 */
export function applyOutcome(
  word: ScheduleInput,
  outcome: ScoredOutcome,
  now: number = Date.now(),
): ScheduleUpdate {
  const current = clampLevel(word.level);

  const level =
    outcome === "clean"
      ? clampLevel(current + 1)
      : outcome === "failed"
        ? clampLevel(current - 2)
        : current;

  const streak =
    outcome === "clean" ? word.streak + 1 : outcome === "assisted" ? word.streak : 0;
  const missed = outcome === "shaky" || outcome === "failed";

  return {
    level,
    streak,
    bestStreak: Math.max(word.bestStreak, streak),
    correctCount: word.correctCount + (outcome === "clean" ? 1 : 0),
    missCount: word.missCount + (missed ? 1 : 0),
    dueAt: dueDateFor(level, now),
  };
}

/* -------------------------------------------------------------------------- */
/*                              Rotation weighting                            */
/* -------------------------------------------------------------------------- */

export type RotationInput = {
  level: number;
  dueAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
};

/**
 * Sampling weight for the next puzzle. Higher = more likely to be drawn.
 *
 * The ordering it produces, strongest pull first:
 *   1. words never practised;
 *   2. words past their review date (the more overdue, the stronger);
 *   3. words not due yet — kept at a small but non-zero weight so a puzzle can
 *      still be filled on a day when nothing is scheduled.
 *
 * Within each band, weaker words (lower level) outweigh stronger ones.
 */
export function rotationWeight(word: RotationInput, now: number = Date.now()): number {
  // level 0 → 1.00, 1 → 0.41, 2 → 0.25, 3 → 0.18, 4 → 0.14, 5 → 0.11
  const fragility = 1 / Math.pow(clampLevel(word.level) + 1, 1.3);

  // Never seen in a puzzle: highest priority, above even a very overdue word.
  if (!word.lastUsedAt || word.usageCount === 0) return 6;

  // Used before but never scheduled (pre-migration rows): treat as due now.
  const due = word.dueAt?.getTime() ?? word.lastUsedAt.getTime();
  const overdueDays = (now - due) / DAY_MS;

  if (overdueDays >= 0) {
    // 1.5× right at the due date, saturating at 5× after ~7 days overdue.
    return fragility * (1.5 + Math.min(overdueDays / 2, 3.5));
  }

  // Not due yet: heavily damped, and more so the longer the remaining wait.
  return (fragility * 0.15) / (1 + Math.abs(overdueDays) / 10);
}
