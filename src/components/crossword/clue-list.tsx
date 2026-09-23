"use client";

import { useEffect, useRef } from "react";

import { CheckIcon } from "@/components/icons";
import type { ClientEntry } from "@/lib/crossword/client-types";
import type { ClueSource } from "@/db/schema";

/** Visual state of one clue, derived from the grid and the last check. */
export type ClueState = "empty" | "partial" | "filled" | "correct" | "wrong" | "given";

/**
 * How hard the clue was written, as 1–3 bars. It follows the word's level, so
 * it doubles as a glance at how well each word is known.
 */
const TIER: Record<ClueSource, { bars: number; title: string }> = {
  simple: { bars: 1, title: "Dica simples, com uma ajuda extra — palavra em aprendizado" },
  definition: { bars: 2, title: "Definição de dicionário — palavra ficando firme" },
  crossword: { bars: 3, title: "Dica curta, estilo jornal — palavra dominada" },
  sentence: { bars: 2, title: "Frase para completar (formato antigo)" },
  translation: { bars: 0, title: "Em português: a IA não respondeu a tempo" },
};

const TEXT_BY_STATE: Record<ClueState, string> = {
  empty: "text-ink",
  partial: "text-ink",
  filled: "text-ink",
  correct: "text-ink-muted line-through decoration-good/70",
  wrong: "text-bad",
  given: "text-ink-muted",
};

export const TRANSLATION_HINT =
  "Mostrar em português. Antes de acertar a palavra conta como ajuda: ela não sobe de nível neste crossword.";

export function TierMeter({ source }: { source: ClueSource }) {
  const tier = TIER[source] ?? TIER.simple;
  if (tier.bars === 0) {
    return (
      <span
        className="bg-warn-soft text-warn rounded px-1 font-mono text-[9px] font-bold"
        title={tier.title}
      >
        PT
      </span>
    );
  }
  return (
    <span className="flex items-end gap-[2px]" title={tier.title} aria-label={tier.title}>
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={`w-[3px] rounded-[1px] ${bar <= tier.bars ? "bg-ink-soft" : "bg-line-strong"}`}
          style={{ height: `${4 + bar * 2}px` }}
        />
      ))}
    </span>
  );
}

/** The Portuguese meaning under a clue. */
export function TranslationLine({ text }: { text: string }) {
  return (
    <span className="mt-1 flex items-baseline gap-1.5 text-[13px] leading-snug">
      <span className="bg-accent-soft text-accent-strong shrink-0 rounded px-1 font-mono text-[9px] font-bold">
        PT
      </span>
      <span className="text-accent-strong">{text}</span>
    </span>
  );
}

/** Small toggle that fetches / shows / hides the Portuguese meaning. */
export function TranslationButton({
  shown,
  loading,
  onClick,
  className = "",
}: {
  shown: boolean;
  loading?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-pressed={shown}
      aria-label={shown ? "Esconder a tradução em português" : "Mostrar a tradução em português"}
      title={TRANSLATION_HINT}
      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide transition-colors disabled:opacity-60 ${
        shown
          ? "border-accent bg-accent text-surface"
          : "border-line-strong bg-surface text-ink-soft hover:border-accent hover:text-accent"
      } ${className}`}
    >
      {loading ? "…" : "PT"}
    </button>
  );
}

export function ClueList({
  title,
  entries,
  activeId,
  stateOf,
  onSelect,
  translationOf,
  onTranslate,
  loadingId,
}: {
  title: string;
  entries: ClientEntry[];
  activeId?: string;
  stateOf: (entry: ClientEntry) => ClueState;
  onSelect: (entry: ClientEntry) => void;
  /** The Portuguese meaning to show under the clue, if it is open. */
  translationOf: (entry: ClientEntry) => string | undefined;
  /** Absent once the puzzle is over — every meaning is shown by then. */
  onTranslate?: (entry: ClientEntry) => void;
  loadingId?: string | null;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  /**
   * Keeps the selected clue visible while the player moves around the grid.
   *
   * Scrolls the list by hand instead of calling `scrollIntoView`, which walks
   * up every scrollable ancestor: on a phone the list is in normal flow, so it
   * would scroll the *window* and yank the board off screen on every tap. When
   * the list is not its own scroll container there is nothing to do.
   */
  useEffect(() => {
    const list = listRef.current;
    const item = activeRef.current;
    if (!list || !item) return;
    if (list.scrollHeight <= list.clientHeight) return;

    // `position: relative` on the list makes it the offset parent, so these are
    // already coordinates inside the scrollable content.
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;

    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [activeId]);

  return (
    <section className="flex min-h-0 flex-col">
      <h3 className="eyebrow border-line mb-1 border-b pb-2">{title}</h3>
      <ul ref={listRef} className="scroll-slim relative min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {entries.map((entry) => {
          const isActive = entry.id === activeId;
          const state = stateOf(entry);
          const translation = translationOf(entry);

          return (
            <li key={entry.id} ref={isActive ? activeRef : undefined} className="relative">
              <button
                type="button"
                onClick={() => onSelect(entry)}
                aria-current={isActive ? "true" : undefined}
                className={`flex w-full gap-2.5 rounded-lg py-2 pl-2 text-left transition-colors ${
                  onTranslate ? "pr-11" : "pr-2"
                } ${isActive ? "bg-word" : "hover:bg-sunken"}`}
              >
                <span
                  className={`mt-px w-5 shrink-0 text-right text-xs font-bold tabular-nums ${
                    isActive ? "text-ink" : "text-ink-muted"
                  }`}
                >
                  {entry.number}
                </span>

                <span className="min-w-0 flex-1">
                  <span className={`text-[15px] leading-snug ${TEXT_BY_STATE[state]}`}>
                    {entry.clue}
                  </span>

                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <TierMeter source={entry.clueSource} />
                    <span className="text-ink-muted font-mono text-[10px]">
                      {entry.enumeration || entry.length}
                    </span>
                    {state === "correct" && (
                      <CheckIcon size={12} className="text-good" aria-label="correta" />
                    )}
                    {state === "wrong" && (
                      <span className="text-bad text-[10px] font-semibold">erro</span>
                    )}
                    {state === "given" && (
                      <span className="text-ink-muted text-[10px] font-semibold">já veio pronta</span>
                    )}
                    {state === "filled" && (
                      <span className="bg-ink-faint h-1.5 w-1.5 rounded-full" title="preenchida" />
                    )}
                  </span>

                  {entry.term && (
                    <span className="text-ink mt-1 block text-sm font-semibold">{entry.term}</span>
                  )}
                  {translation && <TranslationLine text={translation} />}
                </span>
              </button>

              {onTranslate && (
                <TranslationButton
                  shown={Boolean(translation)}
                  loading={loadingId === entry.id}
                  onClick={() => onTranslate(entry)}
                  className="absolute top-2 right-1.5"
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
