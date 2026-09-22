import { env, isAiEnabled } from "./env";

export type ClueRequestItem = {
  term: string;
  translation: string;
};

const SYSTEM_PROMPT = `You write fill-in-the-blank clues for an English vocabulary crossword.
The learner is a Brazilian Portuguese speaker studying English.

For every item you receive, write ONE natural English sentence that uses the target
word or phrasal verb, with the target replaced by exactly five underscores: _____

Hard rules:
- The sentence must be 6 to 16 words long.
- The context must make the missing word unambiguous.
- Never write the target word (or any inflection of it) anywhere in the sentence.
- Use exactly one _____ placeholder per sentence, even for multi-word targets.
- Keep the grammar of the sentence valid when the target replaces the blank.
- Plain text only: no quotes around the sentence, no numbering, no explanations.

Answer with strict JSON and nothing else:
{"clues":[{"term":"<the exact term you received>","sentence":"<the sentence>"}]}`;

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function isValidSentence(sentence: string, term: string): boolean {
  if (!sentence.includes("_____")) return false;
  if (sentence.length < 12 || sentence.length > 220) return false;

  // Reject leaks: the answer must not appear in the clue itself.
  const haystack = sentence.toLowerCase();
  const needle = term.toLowerCase().trim();
  if (needle.length >= 3 && haystack.includes(needle)) return false;

  // Also reject the leak of the longest single token of a phrasal verb.
  const longestToken = needle
    .split(/[\s-]+/)
    .filter((token) => token.length >= 4)
    .sort((a, b) => b.length - a.length)[0];
  if (longestToken && haystack.includes(longestToken)) return false;

  return true;
}

/**
 * Asks OpenRouter for one fill-in-the-blank sentence per item.
 *
 * Never throws: on any failure it returns whatever it managed to parse (often
 * nothing), and the caller falls back to the Portuguese translation clue.
 */
export async function generateClueSentences(
  items: ClueRequestItem[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!isAiEnabled || items.length === 0) return result;

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 45_000);

  try {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: signal ?? timeout.signal,
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.APP_URL,
        "X-Title": env.APP_NAME,
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        temperature: 0.9,
        max_tokens: 200 + items.length * 70,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              items: items.map((item) => ({
                term: item.term,
                portuguese_meaning: item.translation,
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[openrouter] HTTP %s: %s", response.status, await response.text());
      return result;
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return result;

    const parsed = extractJson(content) as { clues?: { term?: string; sentence?: string }[] } | null;
    if (!parsed?.clues?.length) return result;

    const byNormalizedTerm = new Map(items.map((item) => [item.term.toLowerCase(), item.term]));

    for (const clue of parsed.clues) {
      if (!clue?.term || !clue?.sentence) continue;
      const originalTerm = byNormalizedTerm.get(clue.term.toLowerCase().trim());
      if (!originalTerm) continue;

      const sentence = clue.sentence.replace(/\s+/g, " ").trim();
      if (!isValidSentence(sentence, originalTerm)) continue;

      result.set(originalTerm, sentence);
    }
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      console.error("[openrouter] clue generation failed:", error);
    }
  } finally {
    clearTimeout(timer);
  }

  return result;
}
