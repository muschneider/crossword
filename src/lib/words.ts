/**
 * Parsing + normalisation of the user's vocabulary list.
 *
 * Accepted line formats (list markers are optional):
 *   - accomplish - realizar / alcançar / cumprir
 *   * as far as I know — pelo que eu sei
 *   1. at least: pelo menos
 *     achieve = alcançar / atingir
 */

export type ParsedWord = {
  /** Term as typed, trimmed and with collapsed whitespace. */
  term: string;
  /** Lowercased term — the per-user uniqueness key. */
  normalized: string;
  /** A-Z only, uppercase — what actually goes into the grid. */
  answer: string;
  translation: string;
};

export type ParseIssue = {
  line: number;
  content: string;
  reason: string;
};

export type ParseResult = {
  words: ParsedWord[];
  /** Duplicates found *inside the submitted text* (already removed). */
  duplicatesInInput: string[];
  issues: ParseIssue[];
};

/** Longest first so " — " wins over "-" inside e.g. "well-known". */
const SEPARATORS = [" — ", " – ", " - ", " = ", " : ", "—", "–", "=", ":", " - "];

const LIST_MARKER = /^\s*(?:[-*•‣▪]|\d+[.)])\s+/;

export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Strips diacritics so "café" → "cafe" before the A-Z filter. */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** `as far as I know` → `ASFARASIKNOW` */
export function toAnswer(term: string): string {
  return stripDiacritics(term)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

export function normalizeTerm(term: string): string {
  return collapseSpaces(term).toLowerCase();
}

/** `as far as I know` → `(2,3,2,1,4)`; single words return `""`. */
export function enumeration(term: string): string {
  const chunks = collapseSpaces(term)
    .split(/[\s-]+/)
    .map((chunk) => toAnswer(chunk))
    .filter(Boolean);
  if (chunks.length <= 1) return "";
  return `(${chunks.map((chunk) => chunk.length).join(",")})`;
}

function splitLine(line: string): [string, string] | null {
  for (const separator of SEPARATORS) {
    const index = line.indexOf(separator);
    if (index > 0) {
      const term = line.slice(0, index);
      const translation = line.slice(index + separator.length);
      if (term.trim() && translation.trim()) return [term, translation];
    }
  }
  return null;
}

export function parseWordList(input: string): ParseResult {
  const words: ParsedWord[] = [];
  const issues: ParseIssue[] = [];
  const duplicatesInInput: string[] = [];
  const seen = new Map<string, number>();

  const lines = input.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const withoutMarker = rawLine.replace(LIST_MARKER, "");
    const line = collapseSpaces(withoutMarker);

    if (!line) return;
    // Ignore markdown headings / horizontal rules that often get pasted along.
    if (/^#{1,6}\s/.test(line) || /^[-*_]{3,}$/.test(line)) return;

    const parts = splitLine(line);
    if (!parts) {
      issues.push({
        line: lineNumber,
        content: line,
        reason: "Sem separador. Use: termo - tradução",
      });
      return;
    }

    const term = collapseSpaces(parts[0]);
    const translation = collapseSpaces(parts[1]);
    const answer = toAnswer(term);

    if (!answer) {
      issues.push({ line: lineNumber, content: line, reason: "Termo sem letras (A-Z)." });
      return;
    }
    if (answer.length > 24) {
      issues.push({ line: lineNumber, content: line, reason: "Termo longo demais (>24 letras)." });
      return;
    }
    if (translation.length > 300) {
      issues.push({ line: lineNumber, content: line, reason: "Tradução longa demais." });
      return;
    }

    const normalized = normalizeTerm(term);
    const previous = seen.get(normalized);
    if (previous !== undefined) {
      duplicatesInInput.push(term);
      return;
    }

    seen.set(normalized, lineNumber);
    words.push({ term, normalized, answer, translation });
  });

  return { words, duplicatesInInput, issues };
}

/** Length window that actually produces a playable grid. */
export const MIN_GRID_LENGTH = 3;
export const MAX_GRID_LENGTH = 15;

export function isGridUsable(answer: string): boolean {
  return answer.length >= MIN_GRID_LENGTH && answer.length <= MAX_GRID_LENGTH;
}
