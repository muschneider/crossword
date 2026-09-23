"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { generateCrosswordAction } from "@/app/actions/crossword";
import { SparkIcon } from "@/components/icons";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  DIFFICULTY_DESCRIPTIONS,
  DIFFICULTY_LABELS,
  isDifficulty,
  type Difficulty,
} from "@/lib/crossword/difficulty";

const STORAGE_KEY = "mscw:difficulty";

/** How full each level starts, drawn as a 3×3 corner of grid. */
const PREVIEW: Record<Difficulty, number[]> = {
  easy: [0, 1, 2, 4, 6],
  medium: [0, 4],
  hard: [],
};

function Preview({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className="grid grid-cols-3 gap-px" aria-hidden>
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          className={`h-[5px] w-[5px] ${
            PREVIEW[difficulty].includes(index) ? "bg-current" : "border border-current opacity-40"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * Difficulty picker + "generate" button.
 *
 * The difficulty only decides how many letters start on the board; the clues
 * follow each word's own level either way. The last choice is remembered.
 */
export function GenerateButton({
  disabled,
  label = "Gerar crossword",
}: {
  disabled?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);

  // Read after mount: localStorage does not exist during server rendering.
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isDifficulty(saved)) setDifficulty(saved);
  }, []);

  const choose = (value: Difficulty) => {
    setDifficulty(value);
    window.localStorage.setItem(STORAGE_KEY, value);
  };

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await generateCrosswordAction(difficulty);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <fieldset disabled={disabled || isPending}>
        <legend className="label">Dificuldade</legend>
        <div className="border-line-strong bg-surface inline-flex rounded-xl border p-1">
          {DIFFICULTIES.map((value) => (
            <label
              key={value}
              className="text-ink-soft hover:text-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:ring-accent flex cursor-pointer items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors select-none has-focus-visible:ring-2"
            >
              <input
                type="radio"
                name="difficulty"
                value={value}
                checked={difficulty === value}
                onChange={() => choose(value)}
                className="sr-only"
              />
              <Preview difficulty={value} />
              {DIFFICULTY_LABELS[value]}
            </label>
          ))}
        </div>
        <p className="text-ink-muted mt-1.5 text-xs">{DIFFICULTY_DESCRIPTIONS[difficulty]}</p>
      </fieldset>

      <button onClick={onClick} disabled={disabled || isPending} className="btn-primary">
        <SparkIcon className={`h-[18px] w-[18px] ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Gerando e conferindo as dicas…" : label}
      </button>

      {error && <p className="notice-bad">{error}</p>}
    </div>
  );
}
