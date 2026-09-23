import { env, isAiEnabled } from "./env";

export { isAiEnabled };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatJsonOptions = {
  temperature?: number;
  maxTokens?: number;
  /** Hard ceiling for this call, in milliseconds. */
  timeoutMs?: number;
  /** Shows up in the logs, to tell the calls of one pipeline apart. */
  label?: string;
};

/**
 * Parses what a model returned as JSON.
 *
 * Models wrap JSON in code fences or chat around it often enough that a strict
 * `JSON.parse` would throw away perfectly usable answers.
 */
export function extractJson(content: string): unknown {
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

/**
 * One chat completion, answered as a JSON object.
 *
 * Never throws: network errors, HTTP errors, timeouts and unparseable answers
 * all come back as `null`, and the caller decides how to degrade.
 */
export async function chatJson<T>(
  messages: ChatMessage[],
  options: ChatJsonOptions = {},
): Promise<T | null> {
  if (!isAiEnabled) return null;

  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const label = options.label ?? "chat";

  try {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.APP_URL,
        "X-Title": env.APP_NAME,
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1_000,
        response_format: { type: "json_object" },
        messages,
      }),
    });

    if (!response.ok) {
      console.error("[openrouter:%s] HTTP %s: %s", label, response.status, await response.text());
      return null;
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    return extractJson(content) as T | null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      console.warn("[openrouter:%s] timeout after %dms", label, timeoutMs);
    } else {
      console.error("[openrouter:%s] request failed:", label, error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
