"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  checkCrosswordAction,
  deleteCrosswordAction,
  revealLetterAction,
  revealTranslationAction,
  revealWordAction,
  saveProgressAction,
} from "@/app/actions/crossword";
import {
  BulbIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  KeyboardIcon,
  RotateIcon,
  TrashIcon,
} from "@/components/icons";
import type { ClientCrossword, ClientEntry } from "@/lib/crossword/client-types";
import type { Direction } from "@/lib/crossword/types";
import { Board, cellId } from "./board";
import {
  ClueList,
  TierMeter,
  TranslationButton,
  TranslationLine,
  type ClueState,
} from "./clue-list";
import { DifficultyBadge } from "./difficulty-badge";
import { Menu } from "./menu";
import { useKeyboardInset } from "./use-keyboard-inset";

type Cursor = { row: number; col: number };
type Feedback = {
  correctEntries: Set<string>;
  wrongEntries: Set<string>;
  wrongCells: Set<string>;
};

const EMPTY_FEEDBACK: Feedback = {
  correctEntries: new Set(),
  wrongEntries: new Set(),
  wrongCells: new Set(),
};

const key = (row: number, col: number) => `${row},${col}`;

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

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** First entry with an empty square, and that square: where play starts. */
function startingPoint(crossword: ClientCrossword): { cursor: Cursor; direction: Direction } {
  for (const entry of crossword.entries) {
    const empty = entryCells(entry).find((cell) => !crossword.progress[cell.row]?.[cell.col]);
    if (empty) return { cursor: empty, direction: entry.direction };
  }
  const first = crossword.entries[0];
  return {
    cursor: first ? { row: first.row, col: first.col } : { row: 0, col: 0 },
    direction: first?.direction ?? "across",
  };
}

const NOTICE_CLASS = { good: "notice-good", bad: "notice-bad", info: "notice-info" } as const;

export function CrosswordPlayer({ crossword }: { crossword: ClientCrossword }) {
  const router = useRouter();
  const readOnly = crossword.status === "completed";
  const keyboardInset = useKeyboardInset();

  const [grid, setGrid] = useState<string[][]>(() => crossword.progress.map((row) => row.slice()));
  const [cursor, setCursor] = useState<Cursor>(() => startingPoint(crossword).cursor);
  const [direction, setDirection] = useState<Direction>(() => startingPoint(crossword).direction);
  const [feedback, setFeedback] = useState<Feedback>(EMPTY_FEEDBACK);
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "good" | "bad" } | null>(null);
  const [seconds, setSeconds] = useState(crossword.secondsPlayed);
  const [showShortcuts, setShowShortcuts] = useState(false);

  /** Portuguese meanings already fetched (or sent with a finished puzzle). */
  const [translations, setTranslations] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      crossword.entries.flatMap((entry) => (entry.translation ? [[entry.id, entry.translation]] : [])),
    ),
  );
  /** Which of them are open right now. */
  const [openTranslations, setOpenTranslations] = useState<Set<string>>(
    () => new Set(crossword.entries.filter((entry) => entry.translation).map((entry) => entry.id)),
  );
  const [loadingTranslation, setLoadingTranslation] = useState<string | null>(null);
  /** The "counts as help" rule is explained once per puzzle, on first use. */
  const explainedTranslation = useRef(false);

  const [isChecking, startCheck] = useTransition();
  const [isRevealing, startReveal] = useTransition();
  const [isMutating, startMutation] = useTransition();

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const dirtyRef = useRef(false);
  const gridRef = useRef(grid);
  const secondsRef = useRef(seconds);
  gridRef.current = grid;
  secondsRef.current = seconds;

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
    if (activeEntry) for (const cell of entryCells(activeEntry)) set.add(key(cell.row, cell.col));
    return set;
  }, [activeEntry]);

  const correctCells = useMemo(() => {
    const set = new Set<string>();
    for (const entry of crossword.entries) {
      if (!feedback.correctEntries.has(entry.id)) continue;
      for (const cell of entryCells(entry)) set.add(key(cell.row, cell.col));
    }
    return set;
  }, [crossword.entries, feedback.correctEntries]);

  /* ----------------------------- persistence ----------------------------- */

  const flush = useCallback(() => {
    if (readOnly || !dirtyRef.current) return;
    dirtyRef.current = false;
    void saveProgressAction(crossword.id, gridRef.current, secondsRef.current);
  }, [crossword.id, readOnly]);

  useEffect(() => {
    if (readOnly || !dirtyRef.current) return;
    const timer = setTimeout(flush, 1200);
    return () => clearTimeout(timer);
  }, [grid, flush, readOnly]);

  // The clock and the last keystrokes must survive a tab switch or a close.
  useEffect(() => {
    if (readOnly) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush, readOnly]);

  /* -------------------------------- clock -------------------------------- */

  useEffect(() => {
    if (readOnly) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      // A hidden tab does not count, and its throttled ticks must not pile up.
      if (document.visibilityState !== "visible") {
        last = now;
        return;
      }
      const delta = Math.round((now - last) / 1000);
      last = now;
      if (delta > 0) setSeconds((previous) => previous + delta);
    }, 1000);
    return () => clearInterval(timer);
  }, [readOnly]);

  /* ------------------------------ navigation ----------------------------- */

  const focusCell = useCallback((row: number, col: number) => {
    const input = inputs.current.get(cellId(row, col));
    input?.focus();
    input?.select();
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

  /** Pre-filled by the difficulty: locked, typing over it just moves on. */
  const isGiven = useCallback(
    (row: number, col: number) => crossword.givens[row]?.[col] ?? false,
    [crossword.givens],
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

  /** Selects an entry and lands on its first still-empty cell. */
  const selectEntry = useCallback(
    (entry: ClientEntry, source = gridRef.current) => {
      const cells = entryCells(entry);
      const target = cells.find((cell) => !source[cell.row]?.[cell.col]) ?? cells[0];
      setDirection(entry.direction);
      setCursor(target);
      focusCell(target.row, target.col);
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

  /** First entry after the current one that still has an empty cell. */
  const nextUnfinishedEntry = useCallback(
    (from: ClientEntry, source: string[][]) => {
      const index = crossword.entries.findIndex((entry) => entry.id === from.id);
      for (let offset = 1; offset <= crossword.entries.length; offset += 1) {
        const candidate = crossword.entries[(index + offset) % crossword.entries.length];
        if (entryCells(candidate).some((cell) => !source[cell.row]?.[cell.col])) return candidate;
      }
      return null;
    },
    [crossword.entries],
  );

  /* -------------------------------- input -------------------------------- */

  /** Drops the check marks that a manual edit has just invalidated. */
  const invalidateFeedback = useCallback(
    (row: number, col: number) => {
      setFeedback((previous) => {
        if (
          previous.correctEntries.size === 0 &&
          previous.wrongEntries.size === 0 &&
          previous.wrongCells.size === 0
        ) {
          return previous;
        }
        const touched = crossword.entries.filter((entry) => entryContains(entry, row, col));
        const correctEntries = new Set(previous.correctEntries);
        const wrongEntries = new Set(previous.wrongEntries);
        const wrongCells = new Set(previous.wrongCells);
        for (const entry of touched) {
          correctEntries.delete(entry.id);
          wrongEntries.delete(entry.id);
        }
        wrongCells.delete(key(row, col));
        return { correctEntries, wrongEntries, wrongCells };
      });
    },
    [crossword.entries],
  );

  const writeLetter = useCallback(
    (row: number, col: number, letter: string): string[][] => {
      if (isGiven(row, col)) return gridRef.current;
      const next = gridRef.current.map((line) => line.slice());
      next[row][col] = letter;
      gridRef.current = next;
      dirtyRef.current = true;
      setGrid(next);
      invalidateFeedback(row, col);
      return next;
    },
    [invalidateFeedback, isGiven],
  );

  /**
   * Where the cursor goes after a letter is typed.
   *
   * Skips ahead to the next *empty* cell of the word instead of blindly moving
   * one step, and hops to the next unfinished word once the current one is
   * full — the two things that make filling a puzzle feel fast.
   */
  const advanceAfterInput = useCallback(
    (entry: ClientEntry, from: Cursor, source: string[][]) => {
      const cells = entryCells(entry);
      const index = cells.findIndex((cell) => cell.row === from.row && cell.col === from.col);

      for (let i = index + 1; i < cells.length; i += 1) {
        if (!source[cells[i].row]?.[cells[i].col]) {
          moveTo(cells[i].row, cells[i].col);
          return;
        }
      }

      const complete = cells.every((cell) => source[cell.row]?.[cell.col]);
      if (complete) {
        const next = nextUnfinishedEntry(entry, source);
        if (next) {
          selectEntry(next, source);
          return;
        }
      }

      if (index + 1 < cells.length) moveTo(cells[index + 1].row, cells[index + 1].col);
    },
    [moveTo, nextUnfinishedEntry, selectEntry],
  );

  const stepBack = useCallback(() => {
    if (!activeEntry) return;
    const cells = entryCells(activeEntry);
    const index = cells.findIndex((cell) => cell.row === cursor.row && cell.col === cursor.col);
    if (index > 0) moveTo(cells[index - 1].row, cells[index - 1].col);
  }, [activeEntry, cursor, moveTo]);

  const onWrite = useCallback(
    (row: number, col: number, letter: string) => {
      // A pre-filled square keeps its letter; typing on it just moves along.
      const next = isGiven(row, col) ? gridRef.current : writeLetter(row, col, letter);
      if (letter && activeEntry) advanceAfterInput(activeEntry, { row, col }, next);
    },
    [activeEntry, advanceAfterInput, isGiven, writeLetter],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
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
          if (gridRef.current[row][col] && !isGiven(row, col)) writeLetter(row, col, "");
          else stepBack();
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
        onWrite(row, col, event.key.toUpperCase());
      }
    },
    [activeEntry, isGiven, jumpEntry, moveTo, onWrite, readOnly, step, stepBack, writeLetter],
  );

  /**
   * Bound to `onPointerDown`, which fires *before* `onFocus` — otherwise the
   * focus handler would have already moved the cursor onto this cell and every
   * click on a new cell would look like a re-click and flip the direction.
   */
  const onSelectCell = useCallback(
    (row: number, col: number) => {
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
    },
    [crossword.entries, cursor],
  );

  /* ------------------------------- actions ------------------------------- */

  const onCheck = () => {
    startCheck(async () => {
      const response = await checkCrosswordAction(crossword.id, gridRef.current, secondsRef.current);
      dirtyRef.current = false;
      setFeedback({
        correctEntries: new Set(response.correctEntries),
        wrongEntries: new Set(response.wrongEntries),
        wrongCells: new Set(response.wrongCells.map(([row, col]) => key(row, col))),
      });
      setNotice({
        text: response.message,
        tone: response.solved ? "good" : response.wrongCells.length > 0 ? "bad" : "info",
      });
      if (response.solved) router.refresh();
    });
  };

  const onReveal = (mode: "letter" | "word") => {
    if (!activeEntry) return;
    const entryId = activeEntry.id;
    const at = { ...cursor };

    startReveal(async () => {
      const response =
        mode === "word"
          ? await revealWordAction(crossword.id, entryId, gridRef.current)
          : await revealLetterAction(crossword.id, entryId, gridRef.current, at);

      if (response.cells.length > 0) {
        const next = gridRef.current.map((line) => line.slice());
        for (const [row, col, letter] of response.cells) next[row][col] = letter;
        gridRef.current = next;
        dirtyRef.current = false;
        setGrid(next);
        setFeedback(EMPTY_FEEDBACK);

        const entry = crossword.entries.find((candidate) => candidate.id === entryId);
        if (entry) {
          const pending = entryCells(entry).find((cell) => !next[cell.row]?.[cell.col]);
          if (pending) moveTo(pending.row, pending.col);
        }
      }
      setNotice({ text: response.message, tone: response.ok ? "info" : "bad" });
    });
  };

  /**
   * Opens or closes the Portuguese meaning of a word.
   *
   * The first time it goes through the server, which decides whether it counts
   * as help (it does while the word is still unsolved). After that the meaning
   * is kept here, and the button only shows and hides it.
   */
  const onTranslate = async (entry: ClientEntry) => {
    if (translations[entry.id]) {
      setOpenTranslations((previous) => {
        const next = new Set(previous);
        if (next.has(entry.id)) next.delete(entry.id);
        else next.add(entry.id);
        return next;
      });
      return;
    }

    setLoadingTranslation(entry.id);
    try {
      const response = await revealTranslationAction(crossword.id, entry.id, gridRef.current);
      if (!response.ok || !response.translation) {
        setNotice({ text: response.message || "Não foi possível buscar a tradução.", tone: "bad" });
        return;
      }
      const translation = response.translation;
      setTranslations((previous) => ({ ...previous, [entry.id]: translation }));
      setOpenTranslations((previous) => new Set(previous).add(entry.id));

      if (!explainedTranslation.current) {
        explainedTranslation.current = true;
        setNotice({
          // Worded conditionally on purpose: the server does not say whether
          // the word was already right, or this would double as a free check.
          text:
            "Se a palavra ainda não estava certa, ver a tradução conta como ajuda: " +
            "neste crossword ela fica no mesmo nível em vez de subir.",
          tone: "info",
        });
      }
    } finally {
      setLoadingTranslation(null);
    }
  };

  const translationOf = useCallback(
    (entry: ClientEntry) => (openTranslations.has(entry.id) ? translations[entry.id] : undefined),
    [openTranslations, translations],
  );

  const hasGivens = useMemo(() => crossword.givens.some((row) => row.some(Boolean)), [crossword.givens]);

  const onReset = () => {
    const question = hasGivens
      ? "Apagar todas as letras que você digitou? As letras dadas pela dificuldade ficam."
      : "Apagar todas as letras deste crossword?";
    if (!window.confirm(question)) return;
    const next = gridRef.current.map((line, row) =>
      line.map((cell, col) => (isGiven(row, col) ? cell : "")),
    );
    gridRef.current = next;
    dirtyRef.current = true;
    setGrid(next);
    setFeedback(EMPTY_FEEDBACK);
    setNotice({ text: "Grid limpo.", tone: "info" });
  };

  const onDelete = () => {
    const label = readOnly
      ? "Remover este crossword do histórico?"
      : "Remover o crossword atual? Todo o progresso será perdido.";
    if (!window.confirm(label)) return;

    startMutation(async () => {
      const response = await deleteCrosswordAction(crossword.id);
      setNotice({ text: response.message, tone: response.ok ? "info" : "bad" });
      router.refresh();
    });
  };

  /* -------------------------------- derived ------------------------------- */

  const totalCells = useMemo(
    () => crossword.mask.reduce((sum, row) => sum + row.filter(Boolean).length, 0),
    [crossword.mask],
  );
  const filledCount = useMemo(
    () => grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0),
    [grid],
  );
  const percent = totalCells === 0 ? 0 : Math.round((filledCount / totalCells) * 100);
  const busy = isChecking || isRevealing || isMutating;

  const clueStateOf = useCallback(
    (entry: ClientEntry): ClueState => {
      if (entry.given) return "given";
      if (feedback.wrongEntries.has(entry.id)) return "wrong";
      if (readOnly || feedback.correctEntries.has(entry.id)) return "correct";
      const cells = entryCells(entry);
      const filled = cells.filter((cell) => grid[cell.row]?.[cell.col]).length;
      if (filled === 0) return "empty";
      return filled === cells.length ? "filled" : "partial";
    },
    [feedback.correctEntries, feedback.wrongEntries, grid, readOnly],
  );

  const directionLabel = activeEntry?.direction === "down" ? "Vertical" : "Horizontal";
  const activeTranslation = activeEntry ? translationOf(activeEntry) : undefined;

  return (
    <div className="space-y-4">
      {/* Toolbar ---------------------------------------------------------- */}
      <div className="card-solid sticky top-16 z-30 px-3 py-2.5 sm:p-4">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          {/* The title is dead weight while playing on a phone: the clock and
              the counter are what the player actually looks at. */}
          <div className="min-w-0">
            <h2 className="headline hidden items-center gap-2 truncate text-xl sm:flex">
              <span className="truncate">{crossword.title}</span>
              <DifficultyBadge difficulty={crossword.difficulty} />
              {readOnly && (
                <span className="badge bg-good-soft text-good shrink-0 font-sans">concluído</span>
              )}
            </h2>
            <div className="text-ink-soft flex items-center gap-2.5 text-sm sm:mt-1 sm:gap-3 sm:text-xs">
              <span className="flex items-center gap-1 font-semibold tabular-nums">
                <ClockIcon size={14} />
                {formatClock(seconds)}
              </span>
              {/* Only where the buttons leave room for it; ≥640px it sits in the title. */}
              <span className="hidden min-[480px]:inline sm:hidden">
                <DifficultyBadge difficulty={crossword.difficulty} />
              </span>
              {/* Below ~420px the buttons need the room; the bar says the same. */}
              <span className="text-ink-muted hidden tabular-nums min-[420px]:inline">
                {filledCount}/{totalCells}
              </span>
              <span className="text-ink-muted hidden sm:inline">
                {crossword.width}×{crossword.height} · {crossword.entries.length} palavras
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {!readOnly && (
              <>
                <button
                  onClick={onCheck}
                  disabled={busy}
                  className="btn-primary gap-1.5 px-2.5 py-1.5 text-xs sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
                >
                  <CheckIcon size={15} />
                  {isChecking ? "Verificando…" : "Verificar"}
                </button>
                <Menu
                  label={isRevealing ? "…" : "Dica"}
                  icon={<BulbIcon size={15} />}
                  className="btn-secondary gap-1.5 px-2.5 py-1.5 text-xs sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
                  disabled={busy || !activeEntry}
                  items={[
                    {
                      label: "Revelar uma letra",
                      hint: "letra atual",
                      onSelect: () => onReveal("letter"),
                    },
                    {
                      label: "Revelar a palavra",
                      hint: activeEntry ? `${activeEntry.number}` : undefined,
                      onSelect: () => onReveal("word"),
                    },
                  ]}
                />
              </>
            )}
            <Menu
              label=""
              icon={<span className="px-0.5 text-base leading-none">⋯</span>}
              className="btn-ghost px-2 py-1.5 sm:px-2.5"
              items={[
                {
                  label: "Atalhos do teclado",
                  icon: <KeyboardIcon size={15} />,
                  onSelect: () => setShowShortcuts((previous) => !previous),
                },
                ...(readOnly
                  ? []
                  : [
                      {
                        label: "Limpar o grid",
                        icon: <RotateIcon size={15} />,
                        onSelect: onReset,
                      },
                    ]),
                {
                  label: readOnly ? "Descartar do histórico" : "Remover crossword",
                  icon: <TrashIcon />,
                  danger: true,
                  onSelect: onDelete,
                },
              ]}
            />
          </div>
        </div>

        <div className="bg-sunken mt-2.5 h-1 overflow-hidden rounded-full sm:mt-3">
          <div
            className={`${readOnly ? "bg-good" : "bg-accent"} h-full rounded-full transition-[width] duration-300`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {notice && (
        <p role="status" className={NOTICE_CLASS[notice.tone]}>
          {notice.text}
        </p>
      )}

      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        {/* Board --------------------------------------------------------- */}
        <div className="space-y-3">
          {/* Desktop clue banner; the mobile one lives in the fixed bar. */}
          {activeEntry && (
            <div className="bg-word hidden items-start gap-4 rounded-2xl px-4 py-3.5 lg:flex">
              <div className="min-w-0 flex-1">
                <p className="text-ink-soft text-[11px] font-bold tracking-[0.12em] uppercase">
                  {activeEntry.number} {directionLabel}
                  <span className="text-ink-muted ml-2 font-mono font-normal normal-case">
                    {activeEntry.length} letras {activeEntry.enumeration}
                  </span>
                </p>
                <p className="text-ink mt-1 text-[17px] leading-snug">{activeEntry.clue}</p>
                {activeTranslation && <TranslationLine text={activeTranslation} />}
              </div>
              <div className="flex shrink-0 items-center gap-2.5 pt-0.5">
                <TierMeter source={activeEntry.clueSource} />
                {!readOnly && (
                  <TranslationButton
                    shown={Boolean(activeTranslation)}
                    loading={loadingTranslation === activeEntry.id}
                    onClick={() => onTranslate(activeEntry)}
                    className="px-2 py-1 text-[11px]"
                  />
                )}
              </div>
            </div>
          )}

          <div className="border-line bg-sunken rounded-2xl border p-3 sm:p-5">
            <Board
              mask={crossword.mask}
              numbers={crossword.numbers}
              grid={grid}
              givens={crossword.givens}
              cols={crossword.width}
              cursor={cursor}
              highlighted={highlighted}
              wrong={feedback.wrongCells}
              correct={correctCells}
              readOnly={readOnly}
              inputs={inputs}
              onWrite={onWrite}
              onKeyDown={handleKeyDown}
              onSelect={onSelectCell}
            />
          </div>
        </div>

        {/* Clues --------------------------------------------------------- */}
        <div className="card flex flex-col gap-4 p-4 sm:flex-row lg:sticky lg:top-44 lg:h-[calc(100dvh-13rem)] lg:flex-col lg:gap-3">
          {/* `flex-1` only side by side (sm) or inside the fixed-height column
              (lg): stacked on a phone it would stretch the shorter list to the
              taller one's height and leave a blank block. */}
          <div className="flex min-h-0 flex-col sm:w-1/2 sm:flex-1 lg:w-full">
            <ClueList
              title="Horizontais"
              entries={across}
              activeId={activeEntry?.id}
              stateOf={clueStateOf}
              onSelect={(entry) => selectEntry(entry)}
              translationOf={translationOf}
              onTranslate={readOnly ? undefined : onTranslate}
              loadingId={loadingTranslation}
            />
          </div>
          <div className="flex min-h-0 flex-col sm:w-1/2 sm:flex-1 lg:w-full">
            <ClueList
              title="Verticais"
              entries={down}
              activeId={activeEntry?.id}
              stateOf={clueStateOf}
              onSelect={(entry) => selectEntry(entry)}
              translationOf={translationOf}
              onTranslate={readOnly ? undefined : onTranslate}
              loadingId={loadingTranslation}
            />
          </div>
        </div>
      </div>

      {/* Mobile clue bar, kept above the on-screen keyboard ---------------- */}
      {activeEntry && !readOnly && (
        <>
          {/* Spacer so the last clue column is never hidden behind the bar. */}
          <div className={`${activeTranslation ? "h-28" : "h-20"} lg:hidden`} aria-hidden />
          <div
            className="border-line bg-surface shadow-bar fixed inset-x-0 bottom-0 z-40 border-t lg:hidden"
            style={{
              transform: `translateY(-${keyboardInset}px)`,
              paddingBottom: keyboardInset > 0 ? 0 : "env(safe-area-inset-bottom)",
            }}
          >
            <div className="mx-auto flex max-w-6xl items-center gap-1 px-1 py-1.5">
              <button
                type="button"
                onClick={() => jumpEntry(-1)}
                aria-label="Palavra anterior"
                className="btn-ghost shrink-0 self-stretch px-2"
              >
                <ChevronLeftIcon size={20} />
              </button>

              <button
                type="button"
                onClick={() => setDirection((p) => (p === "across" ? "down" : "across"))}
                className="bg-word min-w-0 flex-1 self-stretch rounded-lg px-2.5 py-1.5 text-left"
              >
                <span className="text-ink-soft text-[10px] font-bold tracking-[0.12em] uppercase">
                  {activeEntry.number} {directionLabel}
                  <span className="text-ink-muted ml-1.5 font-mono font-normal normal-case">
                    {activeEntry.length}
                    {activeEntry.enumeration && ` ${activeEntry.enumeration}`}
                  </span>
                </span>
                <span className="text-ink line-clamp-2 block text-[14px] leading-snug">
                  {activeEntry.clue}
                </span>
                {activeTranslation && (
                  <span className="block truncate">
                    <TranslationLine text={activeTranslation} />
                  </span>
                )}
              </button>

              <TranslationButton
                shown={Boolean(activeTranslation)}
                loading={loadingTranslation === activeEntry.id}
                onClick={() => onTranslate(activeEntry)}
                className="shrink-0 px-2 py-1.5 text-[11px]"
              />

              <button
                type="button"
                onClick={() => jumpEntry(1)}
                aria-label="Próxima palavra"
                className="btn-ghost shrink-0 self-stretch px-2"
              >
                <ChevronRightIcon size={20} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["↑ ↓ ← →", "Move o cursor e troca a direção"],
    ["Enter / Espaço", "Alterna horizontal ↔ vertical"],
    ["Tab / Shift+Tab", "Próxima / palavra anterior"],
    ["Backspace", "Apaga e volta uma casa"],
    ["Home", "Vai para o início da palavra"],
    ["Clique na casa", "Seleciona; clicar de novo troca a direção"],
  ];

  return (
    <div className="card relative p-4">
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="btn-ghost absolute top-2 right-2 px-2 py-1"
      >
        ✕
      </button>
      <h3 className="eyebrow mb-3">Atalhos</h3>
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {rows.map(([keys, description]) => (
          <div key={keys} className="flex items-baseline gap-3">
            <dt className="border-line-strong bg-paper text-ink shrink-0 rounded border px-2 py-0.5 font-mono text-[11px]">
              {keys}
            </dt>
            <dd className="text-ink-soft text-xs">{description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

