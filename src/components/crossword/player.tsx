"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  checkCrosswordAction,
  deleteCrosswordAction,
  revealEntryAction,
  saveProgressAction,
  type CheckResult,
} from "@/app/actions/crossword";
import type { ClientCrossword, ClientEntry } from "@/lib/crossword/client-types";
import type { Direction } from "@/lib/crossword/types";

type Cursor = { row: number; col: number };

const cellId = (row: number, col: number) => `cell-${row}-${col}`;

function entryCells(entry: ClientEntry): Cursor[] {
  const dr = entry.direction === "down" ? 1 : 0;
  const dc = entry.direction === "across" ? 1 : 0;
  return Array.from({ length: entry.length }, (_, i) => ({
    row: entry.row + dr * i,
    col: entry.col + dc * i,
  }));
}

function entryContains(entry: ClientEntry, row: number, col: number): boolean {
  if (entry.direction === "across") {
    return entry.row === row && col >= entry.col && col < entry.col + entry.length;
  }
  return entry.col === col && row >= entry.row && row < entry.row + entry.length;
}

export function CrosswordPlayer({ crossword }: { crossword: ClientCrossword }) {
  const router = useRouter();
  const readOnly = crossword.status === "completed";

  const [grid, setGrid] = useState<string[][]>(() => crossword.progress.map((row) => row.slice()));
  const [cursor, setCursor] = useState<Cursor>(() => {
    const first = crossword.entries[0];
    return first ? { row: first.row, col: first.col } : { row: 0, col: 0 };
  });
  const [direction, setDirection] = useState<Direction>(
    () => crossword.entries[0]?.direction ?? "across",
  );
  const [result, setResult] = useState<CheckResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Per-entry reveal counters, as reported by the server on each reveal. */
  const [revealProgress, setRevealProgress] = useState<
    Record<string, { revealed: number; total: number }>
  >({});
  const [isChecking, startCheck] = useTransition();
  const [isRevealing, startReveal] = useTransition();
  const [isMutating, startMutation] = useTransition();

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const dirtyRef = useRef(false);

  const across = useMemo(
    () => crossword.entries.filter((entry) => entry.direction === "across"),
    [crossword.entries],
  );
  const down = useMemo(
    () => crossword.entries.filter((entry) => entry.direction === "down"),
    [crossword.entries],
  );

  const activeEntry = useMemo(() => {
    const sameDirection = crossword.entries.find(
      (entry) => entry.direction === direction && entryContains(entry, cursor.row, cursor.col),
    );
    if (sameDirection) return sameDirection;
    return crossword.entries.find((entry) => entryContains(entry, cursor.row, cursor.col)) ?? null;
  }, [crossword.entries, cursor, direction]);

  const highlighted = useMemo(() => {
    const set = new Set<string>();
    if (activeEntry) {
      for (const cell of entryCells(activeEntry)) set.add(`${cell.row},${cell.col}`);
    }
    return set;
  }, [activeEntry]);

  const correctEntryIds = useMemo(
    () => new Set(result?.correctEntries ?? []),
    [result?.correctEntries],
  );
  const wrongEntryIds = useMemo(() => new Set(result?.wrongEntries ?? []), [result?.wrongEntries]);

  /* ----------------------------- persistence ----------------------------- */

  useEffect(() => {
    if (readOnly || !dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      void saveProgressAction(crossword.id, grid);
    }, 1200);
    return () => clearTimeout(timer);
  }, [grid, crossword.id, readOnly]);

  /* ------------------------------ navigation ----------------------------- */

  const focusCell = useCallback((row: number, col: number) => {
    inputs.current.get(cellId(row, col))?.focus();
    inputs.current.get(cellId(row, col))?.select();
  }, []);

  const isPlayable = useCallback(
    (row: number, col: number) =>
      row >= 0 &&
      col >= 0 &&
      row < crossword.height &&
      col < crossword.width &&
      crossword.mask[row][col],
    [crossword.height, crossword.width, crossword.mask],
  );

  const moveTo = useCallback(
    (row: number, col: number) => {
      if (!isPlayable(row, col)) return;
      setCursor({ row, col });
      focusCell(row, col);
    },
    [focusCell, isPlayable],
  );

  const step = useCallback(
    (dRow: number, dCol: number) => {
      let row = cursor.row + dRow;
      let col = cursor.col + dCol;
      while (row >= 0 && col >= 0 && row < crossword.height && col < crossword.width) {
        if (crossword.mask[row][col]) {
          moveTo(row, col);
          return;
        }
        row += dRow;
        col += dCol;
      }
    },
    [cursor, crossword.height, crossword.width, crossword.mask, moveTo],
  );

  const advance = useCallback(
    (back = false) => {
      const delta = back ? -1 : 1;
      const row = cursor.row + (direction === "down" ? delta : 0);
      const col = cursor.col + (direction === "across" ? delta : 0);
      if (isPlayable(row, col) && activeEntry && entryContains(activeEntry, row, col)) {
        moveTo(row, col);
      }
    },
    [cursor, direction, activeEntry, isPlayable, moveTo],
  );

  const selectEntry = useCallback(
    (entry: ClientEntry) => {
      setDirection(entry.direction);
      setCursor({ row: entry.row, col: entry.col });
      focusCell(entry.row, entry.col);
    },
    [focusCell],
  );

  const jumpEntry = useCallback(
    (offset: number) => {
      if (!activeEntry) return;
      const index = crossword.entries.findIndex((entry) => entry.id === activeEntry.id);
      const next =
        crossword.entries[(index + offset + crossword.entries.length) % crossword.entries.length];
      if (next) selectEntry(next);
    },
    [activeEntry, crossword.entries, selectEntry],
  );

  /* -------------------------------- input -------------------------------- */

  const writeLetter = useCallback(
    (row: number, col: number, letter: string) => {
      setGrid((previous) => {
        const next = previous.map((line) => line.slice());
        next[row][col] = letter;
        return next;
      });
      dirtyRef.current = true;
      setResult(null);

      /**
       * A manual edit makes the reveal counter for the crossing word(s) stale —
       * erasing a revealed letter would otherwise leave the button stuck on
       * "Revelada". Drop it; the next reveal recomputes it server-side.
       */
      setRevealProgress((previous) => {
        const stale = crossword.entries.filter(
          (entry) => previous[entry.id] && entryContains(entry, row, col),
        );
        if (stale.length === 0) return previous;
        const next = { ...previous };
        for (const entry of stale) delete next[entry.id];
        return next;
      });
    },
    [crossword.entries],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (readOnly) return;

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        setDirection("across");
        step(0, -1);
        return;
      case "ArrowRight":
        event.preventDefault();
        setDirection("across");
        step(0, 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        setDirection("down");
        step(-1, 0);
        return;
      case "ArrowDown":
        event.preventDefault();
        setDirection("down");
        step(1, 0);
        return;
      case "Backspace":
        event.preventDefault();
        if (grid[row][col]) writeLetter(row, col, "");
        else advance(true);
        return;
      case "Delete":
        event.preventDefault();
        writeLetter(row, col, "");
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        setDirection((previous) => (previous === "across" ? "down" : "across"));
        return;
      case "Tab":
        event.preventDefault();
        jumpEntry(event.shiftKey ? -1 : 1);
        return;
      case "Home":
        event.preventDefault();
        if (activeEntry) moveTo(activeEntry.row, activeEntry.col);
        return;
      default:
        break;
    }

    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      writeLetter(row, col, event.key.toUpperCase());
      advance();
    }
  };

  /**
   * Bound to `onPointerDown`, which fires *before* `onFocus` — otherwise the
   * focus handler would have already moved the cursor onto this cell and every
   * click on a new cell would look like a re-click and flip the direction.
   */
  const handleCellPointerDown = (row: number, col: number) => {
    const sameCell = cursor.row === row && cursor.col === col;
    const hasAcross = crossword.entries.some(
      (entry) => entry.direction === "across" && entryContains(entry, row, col),
    );
    const hasDown = crossword.entries.some(
      (entry) => entry.direction === "down" && entryContains(entry, row, col),
    );

    if (sameCell && hasAcross && hasDown) {
      setDirection((previous) => (previous === "across" ? "down" : "across"));
    } else if (!hasAcross && hasDown) {
      setDirection("down");
    } else if (hasAcross && !hasDown) {
      setDirection("across");
    }
    setCursor({ row, col });
  };

  /* ------------------------------- actions ------------------------------- */

  const onCheck = () => {
    setNotice(null);
    startCheck(async () => {
      const response = await checkCrosswordAction(crossword.id, grid);
      setResult(response);
      setNotice(response.message);
      if (response.solved) router.refresh();
    });
  };

  /** Reveals the next few letters of the selected word; click again for more. */
  const onReveal = () => {
    if (!activeEntry) return;
    const entryId = activeEntry.id;
    setNotice(null);
    startReveal(async () => {
      const response = await revealEntryAction(crossword.id, entryId, grid);
      if (!response.ok) {
        setNotice(response.message);
        return;
      }
      if (response.cells.length > 0) {
        setGrid((previous) => {
          const next = previous.map((line) => line.slice());
          for (const [row, col, letter] of response.cells) next[row][col] = letter;
          return next;
        });
        setResult(null);
      }
      setRevealProgress((previous) => ({
        ...previous,
        [entryId]: { revealed: response.revealed, total: response.total },
      }));
      setNotice(response.message);
    });
  };

  const onDelete = () => {
    const label = readOnly
      ? "Remover este crossword do histórico?"
      : "Remover o crossword atual? Todo o progresso será perdido.";
    if (!window.confirm(label)) return;

    startMutation(async () => {
      const response = await deleteCrosswordAction(crossword.id);
      setNotice(response.message);
      router.refresh();
    });
  };

  const filledCount = grid.flat().filter(Boolean).length;
  const totalCells = crossword.mask.flat().filter(Boolean).length;
  const busy = isChecking || isRevealing || isMutating;

  const activeReveal = activeEntry ? revealProgress[activeEntry.id] : undefined;
  const revealDone = activeReveal ? activeReveal.revealed >= activeReveal.total : false;
  const revealLabel = !activeReveal
    ? "Revelar letras"
    : revealDone
      ? `Revelada (${activeReveal.total}/${activeReveal.total})`
      : `Revelar mais (${activeReveal.revealed}/${activeReveal.total})`;

  return (
    <div className="space-y-5">
      {/* Toolbar ---------------------------------------------------------- */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            {crossword.title}
            {readOnly && (
              <span className="badge bg-brand-500/15 text-brand-400">concluído</span>
            )}
          </h2>
          <p className="text-ink-400 mt-0.5 text-xs">
            {crossword.width}×{crossword.height} · {crossword.entries.length} palavras ·{" "}
            {filledCount}/{totalCells} letras preenchidas
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <>
              <button onClick={onCheck} disabled={busy} className="btn-primary">
                {isChecking ? "Verificando…" : "Verificar"}
              </button>
              <button
                onClick={onReveal}
                disabled={busy || !activeEntry || revealDone}
                className="btn-secondary"
                title="Revela algumas letras da palavra selecionada; clique de novo para revelar mais"
              >
                {isRevealing ? "Revelando…" : revealLabel}
              </button>
            </>
          )}
          <button onClick={onDelete} disabled={busy} className="btn-danger">
            {readOnly ? "Descartar" : "Remover"}
          </button>
        </div>
      </div>

      {notice && (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            result?.solved
              ? "border-brand-500/30 bg-brand-500/10 text-brand-400"
              : "border-ink-700 bg-ink-900/70 text-ink-200"
          }`}
          role="status"
        >
          {notice}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* Grid ----------------------------------------------------------- */}
        <div className="space-y-3">
          {activeEntry && (
            <div className="card border-brand-500/25 bg-brand-500/5 p-3.5">
              <p className="text-brand-400 text-xs font-bold tracking-wide uppercase">
                {activeEntry.number} {activeEntry.direction === "across" ? "Horizontal" : "Vertical"}
                <span className="text-ink-400 ml-2 font-mono font-normal normal-case">
                  {activeEntry.length} letras {activeEntry.enumeration}
                </span>
              </p>
              <p className="text-ink-100 mt-1.5 text-sm leading-relaxed">{activeEntry.clue}</p>
            </div>
          )}

          <div className="card overflow-auto p-3">
            <div
              className="grid w-max gap-px"
              style={{
                gridTemplateColumns: `repeat(${crossword.width}, var(--cell))`,
                ["--cell" as string]: "clamp(26px, 6.4vw, 40px)",
              }}
            >
              {crossword.mask.map((maskRow, row) =>
                maskRow.map((playable, col) => {
                  if (!playable) {
                    return (
                      <div
                        key={`${row}-${col}`}
                        className="bg-ink-950/40 aspect-square rounded-[3px]"
                      />
                    );
                  }

                  const number = crossword.numbers[row][col];
                  const isCursor = cursor.row === row && cursor.col === col;
                  const isHighlighted = highlighted.has(`${row},${col}`);

                  return (
                    <div key={`${row}-${col}`} className="relative aspect-square">
                      {number > 0 && (
                        <span className="text-ink-400 pointer-events-none absolute top-[1px] left-[2px] z-10 text-[9px] leading-none font-bold">
                          {number}
                        </span>
                      )}
                      <input
                        ref={(node) => {
                          if (node) inputs.current.set(cellId(row, col), node);
                          else inputs.current.delete(cellId(row, col));
                        }}
                        id={cellId(row, col)}
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={1}
                        readOnly={readOnly}
                        aria-label={`Linha ${row + 1}, coluna ${col + 1}`}
                        value={grid[row]?.[col] ?? ""}
                        onChange={(event) => {
                          if (readOnly) return;
                          const letter = event.target.value
                            .toUpperCase()
                            .replace(/[^A-Z]/g, "")
                            .slice(-1);
                          writeLetter(row, col, letter);
                          if (letter) advance();
                        }}
                        onKeyDown={(event) => handleKeyDown(event, row, col)}
                        onFocus={() => setCursor({ row, col })}
                        onPointerDown={() => handleCellPointerDown(row, col)}
                        className={`h-full w-full rounded-[3px] border text-center text-[clamp(12px,3vw,17px)] font-bold uppercase transition-colors focus:outline-none ${
                          isCursor
                            ? "border-brand-400 bg-brand-500/30 text-ink-100"
                            : isHighlighted
                              ? "border-brand-500/30 bg-brand-500/10 text-ink-100"
                              : "border-ink-700 bg-ink-800/80 text-ink-100"
                        } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                      />
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        </div>

        {/* Clues ---------------------------------------------------------- */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <ClueColumn
            title="Horizontais"
            entries={across}
            activeId={activeEntry?.id}
            correct={correctEntryIds}
            wrong={wrongEntryIds}
            onSelect={selectEntry}
          />
          <ClueColumn
            title="Verticais"
            entries={down}
            activeId={activeEntry?.id}
            correct={correctEntryIds}
            wrong={wrongEntryIds}
            onSelect={selectEntry}
          />
        </div>
      </div>
    </div>
  );
}

function ClueColumn({
  title,
  entries,
  activeId,
  correct,
  wrong,
  onSelect,
}: {
  title: string;
  entries: ClientEntry[];
  activeId?: string;
  correct: Set<string>;
  wrong: Set<string>;
  onSelect: (entry: ClientEntry) => void;
}) {
  return (
    <section className="card p-4">
      <h3 className="text-ink-300 mb-3 text-xs font-bold tracking-wider uppercase">{title}</h3>
      <ul className="space-y-1">
        {entries.map((entry) => {
          const isActive = entry.id === activeId;
          const state = wrong.has(entry.id) ? "wrong" : correct.has(entry.id) ? "correct" : "idle";

          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className={`w-full rounded-lg px-2.5 py-2 text-left text-sm leading-relaxed transition-colors ${
                  isActive ? "bg-brand-500/15" : "hover:bg-ink-800"
                }`}
              >
                <span className="text-ink-400 mr-2 font-mono text-xs font-bold">
                  {entry.number}
                </span>
                <span
                  className={
                    state === "wrong"
                      ? "text-red-300"
                      : state === "correct"
                        ? "text-brand-400"
                        : "text-ink-200"
                  }
                >
                  {entry.clue}
                </span>
                <span className="text-ink-400 ml-1.5 font-mono text-xs">
                  ({entry.length}
                  {entry.enumeration && ` ${entry.enumeration}`})
                </span>
                {entry.clueSource === "ai" && (
                  <span className="ml-1.5 align-middle text-[10px] text-sky-400/70" title="Dica gerada por IA">
                    ✦
                  </span>
                )}
                {entry.term && (
                  <span className="text-brand-400 mt-1 block font-semibold">
                    {entry.term}
                    {entry.translation && (
                      <span className="text-ink-400 font-normal"> — {entry.translation}</span>
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
