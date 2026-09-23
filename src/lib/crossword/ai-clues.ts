/**
 * English clue writing, with a blind solver as quality control.
 *
 *   1. write   — the model drafts two candidate clues per word, in the style
 *                the word's level asks for;
 *   2. filter  — local rules drop anything that leaks the answer, has a gap to
 *                fill, talks about grammar instead of meaning, or slips into
 *                Portuguese;
 *   3. solve   — every surviving candidate goes to a *separate* call that only
 *                sees the clue, the letter count and the first letter — about
 *                what a crossing gives a real player. A clue is verified when
 *                the answer is among the solver's top three guesses;
 *   4. repair  — words with no verified candidate are rewritten once, with the
 *                solver's wrong guesses as feedback, and solved again.
 *
 * The solver is what turns "sounds like a clue" into "leads to this answer":
 * vague clues ("A feeling") and clues that fit a same-length synonym better
 * than the answer are caught there instead of reaching the player.
 *
 * Everything runs inside a time budget. When it runs out, the best candidate
 * so far is used even if unverified; only a word with no English candidate at
 * all is left out, and the caller falls back to its Portuguese meaning.
 */
import { chatJson, isAiEnabled } from "@/lib/openrouter";
import { enumeration, toAnswer } from "@/lib/words";
import type { ClueTier } from "./scheduling";

export type ClueStyle = ClueTier;

export type ClueRequest = {
  /** Opaque id the caller uses to find the result, e.g. the word id. */
  key: string;
  /** The answer as the learner typed it, e.g. `pays off`. */
  term: string;
  /** Portuguese meaning — only used to pin down the sense. */
  translation: string;
  style: ClueStyle;
  /** Clues this word already had in earlier puzzles. */
  avoid?: string[];
};

export type GeneratedClue = {
  text: string;
  style: ClueStyle;
  /** A blind solver reached the answer from this clue and the letter count. */
  verified: boolean;
};

export type GenerateCluesOptions = {
  /** Wall-clock budget for the whole pipeline, in milliseconds. */
  budgetMs?: number;
  /** Every candidate with the solver's guesses — for `mise run try:ai`. */
  onReport?: (report: ClueReport[]) => void;
};

export type ClueReport = {
  key: string;
  term: string;
  style: ClueStyle;
  candidates: { text: string; round: number; guesses: string[] | null; verified: boolean }[];
};

const DEFAULT_BUDGET_MS = 40_000;
const WRITE_TIMEOUT_MS = 22_000;
const REPAIR_TIMEOUT_MS = 16_000;
const SOLVE_TIMEOUT_MS = 12_000;
/** Small batches run in parallel: latency is set by the slowest, not the sum. */
const WRITE_BATCH = 4;
const SOLVE_BATCH = 8;
/** How deep in the solver's guesses the answer may be and still count. */
const SOLVER_GUESSES = 3;

/* -------------------------------------------------------------------------- */
/*                                   Prompts                                  */
/* -------------------------------------------------------------------------- */

const WRITER_PROMPT = `You are a professional crossword setter writing clues for a Brazilian learner of English (intermediate level). The answers come from the learner's own vocabulary list: single words, inflected forms (past tense, plural, -ing, comparative, superlative), phrasal verbs and whole expressions.

INPUT: a JSON object {"items":[...]}. Each item has:
- id: echo it back exactly.
- answer: the English answer as the learner wrote it. It may contain a typo; if so, clue the word the learner clearly meant.
- letters: the letter count, e.g. "7", or the length of each word of a multi-word answer, e.g. "2,3,2,1,4".
- meaning_pt: the Portuguese meaning the learner associates with the answer. Use it ONLY to choose the right sense. Never translate it literally and never write Portuguese.
- style: how much help the clue gives (see STYLES).
- avoid (optional): clues already used for this answer. Write something clearly different.
- failed_attempts (optional): earlier clues after which a solver guessed other answers (listed). Write clues that rule those answers out.

STYLES
- "simple": the learner is still learning this answer. A clear definition in plain, everyday English using only common words, 5 to 16 words. Add ONE helping hand after a semicolon that really narrows it down: a common synonym, or a concrete everyday scene. The helping hand must fit the answer's form too, and must never be a generic remark about usage ("often used in conversation", "a word used when...", "used when discussing..."). Write "how you feel" only when the answer itself is a feeling.
- "definition": the learner knows it reasonably well. One precise dictionary-style definition, 3 to 12 words, with no semicolon, no example and no synonym that gives it away.
- "crossword": the learner knows it well. A short, sharp clue in the style of a quality newspaper crossword, 1 to 6 words, no semicolon: an exact synonym or a compact paraphrase.

WHAT MAKES A GOOD CLUE
1. Substitution: the clue could replace the answer in a sentence. Keep the same part of speech and the same form: a past-tense clue for a past-tense answer, plural for plural, "-ing" for "-ing", superlative for superlative, a whole remark for a whole remark.
2. It leads to exactly this answer. Clue the sense given by meaning_pt. If another common word or phrase with the same letter count would also fit, add a detail that rules it out.
3. Phrasal verbs and expressions are clued as one unit, with the same meaning and register (casual phrase, casual clue).
4. It reads like natural English from a good dictionary or a good crossword. No filler such as "A word that means".

NEVER
- Never write a sentence with a gap or ask the solver to complete a sentence: no "___", no "Fill in", no "Complete".
- Never use the answer, any word of it, any form of it (plural, past, -ing, -ly, -er, -est) or any word of the same family ("achievement" for achieve, "knowledge" for know, "play" for playful). Tiny words like a, an, the, to, of, and are allowed.
- Never describe grammar instead of meaning: no "past tense of ...", "plural of ...", "opposite of ...", "synonym of ...".
- Never write Portuguese, quotation marks, numbering, notes, or a final full stop.

EXAMPLES
{"answer":"afraid","letters":"6","meaning_pt":"com medo"}
  simple: Feeling fear; how many people feel about spiders
  definition: Frightened that something bad may happen
  crossword: Scared
{"answer":"brought","letters":"7","meaning_pt":"trouxe"}
  simple: Carried something with you when you came; like a gift for the host
  definition: Took something or someone along to a place
  crossword: Fetched
{"answer":"pays off","letters":"4,3","meaning_pt":"compensa / vale a pena"}
  simple: Gives a good result in the end; what hard work usually does
  definition: Proves worth the effort or the risk
  crossword: Is worthwhile
{"answer":"as far as I know","letters":"2,3,2,1,4","meaning_pt":"pelo que eu sei"}
  simple: What you say when you believe something is true but are not totally sure
  definition: Based on the information I have
  crossword: If I'm not mistaken
{"answer":"cleverest","letters":"9","meaning_pt":"o mais esperto"}
  simple: Most intelligent of all; the one with the best marks in class
  definition: Most intelligent of the whole group
  crossword: Brightest

BAD CLUES, AND WHY
- at least · "Minimum requirement; often used when discussing expectations" → a noun for an adverb phrase, and an empty helping hand. Better: "Not less than; the smallest amount you will accept"
- annoying · "Causing irritation; how you feel in a long queue" → you FEEL annoyed; the queue IS annoying. Better: "Making you a little angry; like a mosquito buzzing in your ear"
- accomplish · "To finish a task; how you feel after a big project" → accomplish is an action, not a feeling. Better: "To finish something difficult; like running a whole marathon"
- another · "One more; a word used when you want to add something" → empty helping hand. Better: "One more of the same kind; what you ask for after a delicious cookie"
- playful · "The puppy was very ___ today" → a gap to fill. Better: "Full of fun and games; like a puppy chasing its tail"
- brought · "Past tense of bring" → grammar, not meaning. Better: "Carried along"

OUTPUT
Two different candidate clues per item, "a" and "b", written from different angles, both in the requested style. Strict JSON only, nothing else:
{"clues":[{"id":"<id>","a":"<clue>","b":"<clue>"}]}`;

const SOLVER_PROMPT = `You are an expert crossword solver. For each clue, give up to ${SOLVER_GUESSES} English answers, most likely first. Every answer must match "fits" exactly: the number of words, the letters in each word, and the first letter. Answers can be single words, inflected forms, phrasal verbs or whole expressions. Apostrophes and hyphens do not count as letters.

Example: {"id":"x","clue":"Without any delay","fits":"2 words (5+4 letters), starting with R"} → {"id":"x","guesses":["right away","right now"]}

INPUT: {"clues":[{"id":"...","clue":"...","fits":"..."}]}
OUTPUT: strict JSON only, nothing else:
{"answers":[{"id":"<id>","guesses":["<best>","<second>","<third>"]}]}`;

/* -------------------------------------------------------------------------- */
/*                                 Local rules                                */
/* -------------------------------------------------------------------------- */

/** Function words an answer may share with its clue without giving anything away. */
const FREE_WORDS = new Set(["a", "an", "the", "to", "of", "and", "or"]);

/** Longest first, so `-ments` wins over `-s`. */
const SUFFIXES = [
  "fulness", "ingly", "ments", "edly", "ment", "ness", "less", "able", "ible", "ings",
  "ful", "ing", "ies", "ied", "est", "ers", "er", "ed", "es", "ly", "s",
];

/**
 * The word itself plus the bases it may have been built from — a crude
 * stemmer, but enough to tell word families apart:
 * `claiming` → `claim`, `stopped` → `stop`, `enemies` → `enemy`,
 * `playful` → `play`, `ruling` → `rule`, `desirable` → `desire`.
 *
 * The word is always kept as is (`clever` also looks like `clev` + `-er`), and
 * a final `e` is only restored after a suffix was removed, so unrelated pairs
 * such as `quite`/`quit` or `plane`/`plan` stay apart.
 */
export function wordForms(word: string): string[] {
  const forms = new Set([word]);
  const suffix = SUFFIXES.find(
    (candidate) => word.endsWith(candidate) && word.length - candidate.length >= 3,
  );
  if (suffix) {
    let root = word.slice(0, -suffix.length);
    if (suffix === "ies" || suffix === "ied") root += "y";
    forms.add(root);
    if (/^[aeiy]/.test(suffix)) forms.add(`${root}e`); // ruling → rule
    if (/([b-df-hj-np-tv-z])\1$/.test(root)) forms.add(root.slice(0, -1)); // stopped → stop
  }
  return [...forms];
}

export function sameFamily(a: string, b: string): boolean {
  const formsOfB = wordForms(b);
  for (const x of wordForms(a)) {
    for (const y of formsOfB) {
      if (x === y) return true;
      // `accomplish` / `accomplishment`, `complain` / `complaint`, `know` / `knowledge`.
      // A 4-letter base needs a real ending after it, or `quit` would match `quite`.
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      if (!long.startsWith(short)) continue;
      if (short.length >= 5 || (short.length === 4 && long.length - short.length >= 3)) return true;
    }
  }
  return false;
}

/** At most one letter inserted, removed or swapped for another. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * True when the clue gives the answer away.
 *
 * Catches the answer itself, its regular inflections, words of the same family
 * (`claim` for `claiming`, `clever` for `cleverest`, `play` for `playful`) and,
 * for expressions, the whole phrase or two of its words side by side.
 */
export function leaksAnswer(text: string, term: string): boolean {
  const clueWords = text
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const haystack = ` ${clueWords.join(" ")} `;

  const tokens = term
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;

  const phrase = tokens.join(" ");
  if (phrase.length >= 3 && haystack.includes(` ${phrase} `)) return true;

  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const [first, second] = [tokens[i], tokens[i + 1]];
    if (FREE_WORDS.has(first) || FREE_WORDS.has(second)) continue;
    if (haystack.includes(` ${first} ${second} `)) return true;
  }

  const candidates = clueWords.filter((word) => word.length >= 3);

  for (const token of tokens) {
    if (FREE_WORDS.has(token)) continue;

    // In a two-word answer even a short word is half of it: "My mistake" for
    // `my bad`, "No chance" for `no way`.
    if (token.length === 2) {
      if (tokens.length <= 2 && haystack.includes(` ${token} `)) return true;
      continue;
    }
    if (token.length < 3) continue;

    if (new RegExp(`\\b${token}(?:s|es|ed|d|ing|ly|er|est)?\\b`).test(haystack)) return true;
    if (candidates.some((word) => sameFamily(token, word))) return true;
    // The learner's typo against the real spelling: `whose` for `whoose`.
    if (token.length >= 5 && candidates.some((word) => word.length >= 4 && oneEditApart(token, word))) {
      return true;
    }
  }

  return false;
}

/** Words per style, with some slack over what the prompt asks for. */
const WORD_RANGE: Record<ClueStyle, [number, number]> = {
  simple: [3, 22],
  definition: [2, 16],
  crossword: [1, 8],
};

const HAS_GAP = /_{2,}|…|\.{3}|\b(?:fill in|complete the|blank)\b/i;
const TALKS_GRAMMAR =
  /\b(?:past (?:tense|participle)|plural|gerund|infinitive|third[- ]person|ing form|form of|short for|opposite of|synonym (?:of|for)|antonym)\b/i;
const HAS_ACCENTS = /[\u00C0-\u017F]/;

export function isValidClue(text: string, term: string, style: ClueStyle): boolean {
  if (text.length < 2 || text.length > 170) return false;
  if (HAS_ACCENTS.test(text)) return false; // Portuguese slipped in
  if (HAS_GAP.test(text)) return false;
  if (TALKS_GRAMMAR.test(text)) return false;

  const words = text.split(/\s+/).filter(Boolean).length;
  const [min, max] = WORD_RANGE[style];
  if (words < min || words > max) return false;

  return !leaksAnswer(text, term);
}

/** Quotes, labels, letter counts and the final full stop models like to add. */
export function cleanClue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:clue|[ab])\s*:\s*/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s*\(\d+(?:[,\s-]+\d+)*\)\s*$/, "") // the UI shows the enumeration itself
    .replace(/\s*\.+$/, "")
    .trim();
  if (!text) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const sameText = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z]+/g, "") === b.toLowerCase().replace(/[^a-z]+/g, "");

/** `7` for one word, `2,3,2,1,4` for `as far as I know` — what the writer sees. */
function lettersOf(term: string): string {
  const parts = enumeration(term);
  return parts ? parts.slice(1, -1) : String(toAnswer(term).length);
}

/**
 * What the solver sees: `9 letters, starting with C`, or
 * `5 words (2+3+2+1+4 letters), starting with A`. Spelled out because models
 * misread a bare `2,3,2,1,4` and answer with fragments.
 */
function fitOf(term: string): string {
  const answer = toAnswer(term);
  const parts = enumeration(term);
  const shape = parts
    ? `${parts.slice(1, -1).split(",").length} words (${parts.slice(1, -1).split(",").join("+")} letters)`
    : `${answer.length} letters`;
  return `${shape}, starting with ${answer.charAt(0)}`;
}

/**
 * Keeps each style honest. Only `simple` may carry a helping hand after a
 * semicolon; models keep adding one to definitions and crossword clues too, and
 * cutting it is cheaper than asking again.
 */
function fitStyle(text: string, style: ClueStyle): string {
  if (style === "simple") return text;
  return text.split(/\s*;\s*/)[0].trim();
}

/* -------------------------------------------------------------------------- */
/*                                  Pipeline                                  */
/* -------------------------------------------------------------------------- */

type Candidate = {
  text: string;
  round: number;
  /** `null` until the solver has seen it. */
  guesses: string[] | null;
  /** Position of the answer among the guesses; `null` = not reached. */
  rank: number | null;
};

type WordState = {
  id: string;
  request: ClueRequest;
  answer: string;
  letters: string;
  fit: string;
  candidates: Candidate[];
};

type WriterReply = { clues?: Record<string, unknown>[] };
type SolverReply = { answers?: { id?: unknown; guesses?: unknown }[] };

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const isVerified = (candidate: Candidate) => candidate.rank !== null;

/**
 * Where the answer sits among the solver's guesses, or `null` if absent.
 *
 * Solvers often land on the right word in the wrong form — "breakthroughs",
 * "complaining" — despite the letter count. The clue did its job, so that still
 * counts, ranked after every exact hit.
 */
function rankOf(guesses: string[], answer: string): number | null {
  const letters = guesses.map((guess) => toAnswer(guess));
  const exact = letters.indexOf(answer);
  if (exact !== -1) return exact;

  // Same base word only — a prefix match would let "break" verify `breakthrough`.
  const bases = new Set(wordForms(answer.toLowerCase()));
  const inflected = letters.findIndex(
    (guess) => guess.length >= 3 && wordForms(guess.toLowerCase()).some((form) => bases.has(form)),
  );
  return inflected === -1 ? null : SOLVER_GUESSES + inflected;
}

/** Accepts `a`/`b`, a `clues`/`candidates` array, or a single `clue`/`text`. */
function draftsOf(entry: Record<string, unknown>): unknown[] {
  const list = entry.candidates ?? entry.clues;
  if (Array.isArray(list)) return list;
  return [entry.a, entry.b, entry.clue, entry.text].filter((value) => value !== undefined);
}

async function writeRound(states: WordState[], round: number, timeoutMs: number): Promise<void> {
  if (states.length === 0 || timeoutMs < 3_000) return;

  await Promise.all(
    chunk(states, WRITE_BATCH).map(async (group, index) => {
      const items = group.map((state) => {
        const failed = state.candidates
          .filter((candidate) => candidate.guesses !== null && !isVerified(candidate))
          .map((candidate) => ({ clue: candidate.text, solver_answered: candidate.guesses }));
        return {
          id: state.id,
          answer: state.request.term,
          letters: state.letters,
          meaning_pt: state.request.translation,
          style: state.request.style,
          ...(state.request.avoid?.length ? { avoid: state.request.avoid } : {}),
          ...(failed.length > 0 ? { failed_attempts: failed } : {}),
        };
      });

      const reply = await chatJson<WriterReply>(
        [
          { role: "system", content: WRITER_PROMPT },
          { role: "user", content: JSON.stringify({ items }) },
        ],
        {
          temperature: round === 1 ? 0.7 : 0.9,
          maxTokens: 300 + group.length * 140,
          timeoutMs,
          label: `write${round}.${index + 1}`,
        },
      );

      for (const entry of reply?.clues ?? []) {
        if (!entry || typeof entry !== "object") continue;
        const state = group.find((candidate) => candidate.id === String(entry.id ?? "").trim());
        if (!state) continue;

        for (const draft of draftsOf(entry)) {
          const cleaned = cleanClue(draft);
          const text = cleaned && fitStyle(cleaned, state.request.style);
          if (!text || !isValidClue(text, state.request.term, state.request.style)) continue;
          if (state.candidates.some((candidate) => sameText(candidate.text, text))) continue;
          if (state.request.avoid?.some((previous) => sameText(previous, text))) continue;
          state.candidates.push({ text, round, guesses: null, rank: null });
        }
      }
    }),
  );
}

async function solveRound(states: WordState[], timeoutMs: number): Promise<void> {
  if (timeoutMs < 2_000) return;

  const pending = states.flatMap((state) =>
    state.candidates
      .map((candidate, index) => ({ state, candidate, id: `${state.id}.${index + 1}` }))
      .filter(({ candidate }) => candidate.guesses === null),
  );
  if (pending.length === 0) return;

  await Promise.all(
    chunk(pending, SOLVE_BATCH).map(async (group, index) => {
      const reply = await chatJson<SolverReply>(
        [
          { role: "system", content: SOLVER_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              clues: group.map(({ id, candidate, state }) => ({
                id,
                clue: candidate.text,
                fits: state.fit,
              })),
            }),
          },
        ],
        {
          temperature: 0,
          maxTokens: 150 + group.length * 45,
          timeoutMs,
          label: `solve.${index + 1}`,
        },
      );

      for (const answer of reply?.answers ?? []) {
        const item = group.find(({ id }) => id === String(answer?.id ?? "").trim());
        if (!item || !Array.isArray(answer.guesses)) continue;

        const guesses = answer.guesses
          .filter((guess): guess is string => typeof guess === "string")
          .slice(0, SOLVER_GUESSES);
        item.candidate.guesses = guesses;
        item.candidate.rank = rankOf(guesses, item.state.answer);
      }
    }),
  );
}

/**
 * Verified beats unverified; among verified, the answer ranked highest by the
 * solver wins. Without a verified candidate, untested beats known-failed, and
 * then the first draft wins: repair drafts are written to dodge the solver's
 * guesses, which are often legitimate synonyms, and come out more contorted.
 */
function pickBest(candidates: Candidate[]): Candidate | null {
  const verified = candidates
    .filter(isVerified)
    .sort((a, b) => a.rank! - b.rank! || a.round - b.round);
  if (verified.length > 0) return verified[0];

  const fallback = [...candidates].sort(
    (a, b) => Number(a.guesses !== null) - Number(b.guesses !== null) || a.round - b.round,
  );
  return fallback[0] ?? null;
}

/**
 * Writes one English clue per request. Never throws.
 *
 * The map is keyed by `ClueRequest.key`. A key that is missing means no usable
 * English clue came back at all — the caller decides the fallback.
 */
export async function generateClues(
  requests: ClueRequest[],
  options: GenerateCluesOptions = {},
): Promise<Map<string, GeneratedClue>> {
  const result = new Map<string, GeneratedClue>();
  if (!isAiEnabled || requests.length === 0) return result;

  const started = Date.now();
  const deadline = started + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  const left = () => deadline - Date.now();

  const states: WordState[] = requests.map((request, index) => ({
    id: `w${index + 1}`,
    request,
    answer: toAnswer(request.term),
    letters: lettersOf(request.term),
    fit: fitOf(request.term),
    candidates: [],
  }));

  await writeRound(states, 1, Math.min(WRITE_TIMEOUT_MS, left() - 6_000));
  await solveRound(states, Math.min(SOLVE_TIMEOUT_MS, left() - 2_000));

  const unresolved = states.filter((state) => !state.candidates.some(isVerified));
  if (unresolved.length > 0 && left() > 14_000) {
    await writeRound(unresolved, 2, Math.min(REPAIR_TIMEOUT_MS, left() - 6_000));
    await solveRound(unresolved, Math.min(SOLVE_TIMEOUT_MS, left() - 1_000));
  }

  let verified = 0;
  for (const state of states) {
    const best = pickBest(state.candidates);
    if (!best) continue;
    if (isVerified(best)) verified += 1;
    result.set(state.request.key, {
      text: best.text,
      style: state.request.style,
      verified: isVerified(best),
    });
  }

  console.info(
    "[clues] %d pedidas · %d verificadas · %d sem verificação · %d sem dica · %dms",
    requests.length,
    verified,
    result.size - verified,
    requests.length - result.size,
    Date.now() - started,
  );

  options.onReport?.(
    states.map((state) => ({
      key: state.request.key,
      term: state.request.term,
      style: state.request.style,
      candidates: state.candidates.map((candidate) => ({
        text: candidate.text,
        round: candidate.round,
        guesses: candidate.guesses,
        verified: isVerified(candidate),
      })),
    })),
  );

  return result;
}
