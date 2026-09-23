"use server";

import { revalidatePath } from "next/cache";

import type { Crossword, ProgressGrid } from "@/db/schema";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_LABELS,
  isDifficulty,
} from "@/lib/crossword/difficulty";
import {
  applyGivens,
  checkGrid,
  completeCrossword,
  deleteCrossword,
  generateCrosswordForUser,
  getCrosswordById,
  isEntrySolved,
  markTranslationUsed,
  recordReveal,
  recordWrongChecks,
  revealLetter,
  revealWord,
  saveProgress,
  type RevealCells,
} from "@/lib/crossword/service";
import { actionFailure, type ActionState } from "@/lib/action-state";
import { requireApprovedUserOrThrow } from "@/lib/session";

type CrosswordActionState = ActionState;

const failure = actionFailure;

function revalidateCrosswordPages() {
  revalidatePath("/crossword");
  revalidatePath("/dashboard");
}

/**
 * Keeps a hostile/buggy client from writing junk into the JSONB column, and
 * puts back any pre-filled letter the client tried to erase.
 */
function sanitizeProgress(
  value: unknown,
  crossword: Pick<Crossword, "width" | "height" | "grid" | "givens">,
): ProgressGrid {
  if (!Array.isArray(value)) throw new Error("Progresso inválido.");

  const progress = Array.from({ length: crossword.height }, (_, row) => {
    const source = Array.isArray(value[row]) ? (value[row] as unknown[]) : [];
    return Array.from({ length: crossword.width }, (_, col) => {
      const cell = source[col];
      if (typeof cell !== "string") return "";
      const letter = cell.toUpperCase().replace(/[^A-Z]/g, "");
      return letter.slice(0, 1);
    });
  });

  return applyGivens(progress, crossword);
}

/** Caps the reported clock at 12h so a tab left open overnight cannot poison it. */
function sanitizeSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.floor(value), 12 * 60 * 60);
}

export async function generateCrosswordAction(difficulty?: unknown): Promise<CrosswordActionState> {
  try {
    const user = await requireApprovedUserOrThrow();
    const level = isDifficulty(difficulty) ? difficulty : DEFAULT_DIFFICULTY;
    const { crossword, fallbackClues } = await generateCrosswordForUser(user.id, level);
    revalidateCrosswordPages();

    const base = `${crossword.title} (${DIFFICULTY_LABELS[level].toLowerCase()}) gerado.`;
    return {
      ok: true,
      message:
        fallbackClues > 0
          ? `${base} ${fallbackClues} dica(s) ficaram em português porque a IA não respondeu a tempo.`
          : base,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function saveProgressAction(
  crosswordId: string,
  progress: string[][],
  secondsPlayed?: number,
): Promise<CrosswordActionState> {
  try {
    const user = await requireApprovedUserOrThrow();
    const current = await getCrosswordById(user.id, crosswordId);
    if (!current) return { ok: false, message: "Crossword não encontrado." };
    if (current.crossword.status !== "active") {
      return { ok: false, message: "Este crossword já foi finalizado." };
    }

    await saveProgress(
      user.id,
      crosswordId,
      sanitizeProgress(progress, current.crossword),
      sanitizeSeconds(secondsPlayed),
    );
    return { ok: true, message: "Progresso salvo." };
  } catch (error) {
    return failure(error);
  }
}

export type CheckResult = {
  ok: boolean;
  message: string;
  solved: boolean;
  correctCells: number;
  totalCells: number;
  /** Entry ids that are complete and correct. */
  correctEntries: string[];
  /** Entry ids that have at least one wrong letter (ignoring blanks). */
  wrongEntries: string[];
  /** `[row, col]` of every filled cell holding the wrong letter. */
  wrongCells: [number, number][];
};

const EMPTY_CHECK: CheckResult = {
  ok: false,
  message: "",
  solved: false,
  correctCells: 0,
  totalCells: 0,
  correctEntries: [],
  wrongEntries: [],
  wrongCells: [],
};

/**
 * Server-side verification. The solution grid stays on the server, so this is
 * the only way to know whether a puzzle is right.
 *
 * Returns the wrong cells as well as the wrong entries: painting the offending
 * letters red is what "check" means in a crossword, and it is far more useful
 * than being told a count.
 */
export async function checkCrosswordAction(
  crosswordId: string,
  progress: string[][],
  secondsPlayed?: number,
): Promise<CheckResult> {
  try {
    const user = await requireApprovedUserOrThrow();
    const current = await getCrosswordById(user.id, crosswordId);
    if (!current) return { ...EMPTY_CHECK, message: "Crossword não encontrado." };

    const { crossword, entries } = current;
    const grid = sanitizeProgress(progress, crossword);

    const summary = checkGrid(crossword.grid, grid, entries);

    const correctEntries: string[] = [];
    const wrongEntries: string[] = [];
    /** Entries the player believed were finished — those count as a real miss. */
    const fullyWrongEntries: string[] = [];
    const wrongCells: [number, number][] = [];
    const seenCell = new Set<string>();

    for (const entry of entries) {
      const dr = entry.direction === "down" ? 1 : 0;
      const dc = entry.direction === "across" ? 1 : 0;

      let filled = 0;
      let wrong = 0;
      for (let i = 0; i < entry.answer.length; i += 1) {
        const row = entry.row + dr * i;
        const col = entry.col + dc * i;
        const letter = grid[row]?.[col] ?? "";
        if (!letter) continue;
        filled += 1;
        if (letter !== entry.answer[i]) {
          wrong += 1;
          const key = `${row},${col}`;
          if (!seenCell.has(key)) {
            seenCell.add(key);
            wrongCells.push([row, col]);
          }
        }
      }

      if (wrong > 0) {
        wrongEntries.push(entry.id);
        if (filled === entry.answer.length) fullyWrongEntries.push(entry.id);
      } else if (filled === entry.answer.length) {
        correctEntries.push(entry.id);
      }
    }

    if (crossword.status === "active") {
      await saveProgress(user.id, crosswordId, grid, sanitizeSeconds(secondsPlayed));
      if (fullyWrongEntries.length > 0) {
        await recordWrongChecks(crosswordId, fullyWrongEntries);
      }
      if (summary.solved) {
        await completeCrossword(user.id, crosswordId);
        revalidateCrosswordPages();
      }
    }

    const remaining = summary.totalCells - summary.correctCells;

    return {
      ok: true,
      solved: summary.solved,
      correctCells: summary.correctCells,
      totalCells: summary.totalCells,
      correctEntries,
      wrongEntries,
      wrongCells,
      message: summary.solved
        ? "Crossword concluído!"
        : wrongCells.length > 0
          ? `${wrongCells.length} letra(s) errada(s) — marcadas em vermelho.`
          : `Tudo certo até aqui. Faltam ${remaining} letra(s).`,
    };
  } catch (error) {
    return {
      ...EMPTY_CHECK,
      message: error instanceof Error ? error.message : "Erro inesperado.",
    };
  }
}

export type RevealResult = {
  ok: boolean;
  message: string;
  cells: RevealCells;
};

/**
 * Hands out letters of the selected word.
 *
 * `progress` comes from the client because the stored grid lags behind by up to
 * one autosave debounce; using the stale copy would both re-reveal letters the
 * player just typed and overwrite them on save.
 *
 * Every revealed letter is charged to the entries that contain it, which is
 * what later decides whether the word was learned or merely finished.
 */
async function reveal(
  crosswordId: string,
  entryId: string,
  progress: string[][],
  mode: "letter" | "word",
  cursor?: { row: number; col: number },
): Promise<RevealResult> {
  try {
    const user = await requireApprovedUserOrThrow();
    const current = await getCrosswordById(user.id, crosswordId);
    if (!current) return { ok: false, message: "Crossword não encontrado.", cells: [] };

    const { crossword, entries } = current;
    if (crossword.status !== "active") {
      return { ok: false, message: "Este crossword já foi finalizado.", cells: [] };
    }

    const entry = entries.find((candidate) => candidate.id === entryId);
    if (!entry) return { ok: false, message: "Palavra não encontrada.", cells: [] };

    const grid = sanitizeProgress(progress, crossword);
    const cells = mode === "word" ? revealWord(entry, grid) : revealLetter(entry, grid, cursor);

    if (cells.length === 0) {
      return { ok: true, message: `"${entry.term}" já está completa.`, cells: [] };
    }

    for (const [row, col, letter] of cells) grid[row][col] = letter;
    await saveProgress(user.id, crosswordId, grid);
    await recordReveal(crosswordId, entries, cells);

    return {
      ok: true,
      cells,
      message:
        mode === "word"
          ? `Palavra revelada: "${entry.term}".`
          : `Letra revelada em ${entry.number} ${
              entry.direction === "across" ? "horizontal" : "vertical"
            }.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Erro inesperado.",
      cells: [],
    };
  }
}

export async function revealLetterAction(
  crosswordId: string,
  entryId: string,
  progress: string[][],
  cursor: { row: number; col: number },
): Promise<RevealResult> {
  return reveal(crosswordId, entryId, progress, "letter", cursor);
}

export async function revealWordAction(
  crosswordId: string,
  entryId: string,
  progress: string[][],
): Promise<RevealResult> {
  return reveal(crosswordId, entryId, progress, "word");
}

export type TranslationResult = {
  ok: boolean;
  message: string;
  translation?: string;
};

/**
 * Shows the Portuguese meaning of one entry.
 *
 * Looking it up while the word is still unsolved counts as help — it is what
 * the clue used to be for a brand-new word — so the word will not be promoted
 * this time. Once the word is right on the board it is free: that is checking
 * the meaning, not getting help. The answer says nothing about which case
 * applied, or the button would double as a free "is this word right?" check.
 */
export async function revealTranslationAction(
  crosswordId: string,
  entryId: string,
  progress: string[][],
): Promise<TranslationResult> {
  try {
    const user = await requireApprovedUserOrThrow();
    const current = await getCrosswordById(user.id, crosswordId);
    if (!current) return { ok: false, message: "Crossword não encontrado." };

    const { crossword, entries } = current;
    const entry = entries.find((candidate) => candidate.id === entryId);
    if (!entry) return { ok: false, message: "Palavra não encontrada." };

    if (crossword.status === "active" && !entry.usedTranslation) {
      const grid = sanitizeProgress(progress, crossword);
      if (!isEntrySolved(entry, grid)) await markTranslationUsed(crosswordId, entry.id);
    }

    return { ok: true, message: "", translation: entry.translation };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Erro inesperado." };
  }
}

export async function deleteCrosswordAction(crosswordId: string): Promise<CrosswordActionState> {
  try {
    const user = await requireApprovedUserOrThrow();
    await deleteCrossword(user.id, crosswordId);
    revalidateCrosswordPages();
    return { ok: true, message: "Crossword removido. Você já pode gerar outro." };
  } catch (error) {
    return failure(error);
  }
}
