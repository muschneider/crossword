"use server";

import { revalidatePath } from "next/cache";

import type { ProgressGrid } from "@/db/schema";
import {
  checkGrid,
  completeCrossword,
  deleteCrossword,
  generateCrosswordForUser,
  getCrosswordById,
  nextRevealCells,
  saveProgress,
} from "@/lib/crossword/service";
import { actionFailure, type ActionState } from "@/lib/action-state";
import { requireApprovedUserOrThrow } from "@/lib/session";

type CrosswordActionState = ActionState;

const failure = actionFailure;

function revalidateCrosswordPages() {
  revalidatePath("/crossword");
  revalidatePath("/dashboard");
}

/** Keeps a hostile/buggy client from writing junk into the JSONB column. */
function sanitizeProgress(value: unknown, width: number, height: number): ProgressGrid {
  if (!Array.isArray(value)) throw new Error("Progresso inválido.");

  return Array.from({ length: height }, (_, row) => {
    const source = Array.isArray(value[row]) ? (value[row] as unknown[]) : [];
    return Array.from({ length: width }, (_, col) => {
      const cell = source[col];
      if (typeof cell !== "string") return "";
      const letter = cell.toUpperCase().replace(/[^A-Z]/g, "");
      return letter.slice(0, 1);
    });
  });
}

export async function generateCrosswordAction(): Promise<CrosswordActionState> {
  try {
    const user = await requireApprovedUserOrThrow();
    const crossword = await generateCrosswordForUser(user.id);
    revalidateCrosswordPages();
    return { ok: true, message: `${crossword.title} gerado.` };
  } catch (error) {
    return failure(error);
  }
}

export async function saveProgressAction(
  crosswordId: string,
  progress: string[][],
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
      sanitizeProgress(progress, current.crossword.width, current.crossword.height),
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
};

/**
 * Server-side verification. The solution grid stays on the server, so this is
 * the only way to know whether a puzzle is right.
 */
export async function checkCrosswordAction(
  crosswordId: string,
  progress: string[][],
): Promise<CheckResult> {
  const empty: CheckResult = {
    ok: false,
    message: "",
    solved: false,
    correctCells: 0,
    totalCells: 0,
    correctEntries: [],
    wrongEntries: [],
  };

  try {
    const user = await requireApprovedUserOrThrow();
    const current = await getCrosswordById(user.id, crosswordId);
    if (!current) return { ...empty, message: "Crossword não encontrado." };

    const { crossword, entries } = current;
    const grid = sanitizeProgress(progress, crossword.width, crossword.height);

    const summary = checkGrid(crossword.grid, grid, entries);

    const correctEntries: string[] = [];
    const wrongEntries: string[] = [];

    for (const entry of entries) {
      const dr = entry.direction === "down" ? 1 : 0;
      const dc = entry.direction === "across" ? 1 : 0;

      let filled = 0;
      let wrong = 0;
      for (let i = 0; i < entry.answer.length; i += 1) {
        const letter = grid[entry.row + dr * i]?.[entry.col + dc * i] ?? "";
        if (!letter) continue;
        filled += 1;
        if (letter !== entry.answer[i]) wrong += 1;
      }

      if (wrong > 0) wrongEntries.push(entry.id);
      else if (filled === entry.answer.length) correctEntries.push(entry.id);
    }

    if (crossword.status === "active") {
      await saveProgress(user.id, crosswordId, grid);
      if (summary.solved) {
        await completeCrossword(user.id, crosswordId);
        revalidateCrosswordPages();
      }
    }

    return {
      ok: true,
      solved: summary.solved,
      correctCells: summary.correctCells,
      totalCells: summary.totalCells,
      correctEntries,
      wrongEntries,
      message: summary.solved
        ? "Crossword concluído! Agora você pode gerar um novo."
        : `${summary.correctCells}/${summary.totalCells} letras corretas` +
          (wrongEntries.length > 0 ? ` — ${wrongEntries.length} palavra(s) com erro.` : "."),
    };
  } catch (error) {
    return { ...empty, message: error instanceof Error ? error.message : "Erro inesperado." };
  }
}

export type RevealResult = {
  ok: boolean;
  message: string;
  /** `[row, col, letter]` triples to write into the client grid. */
  cells: [number, number, string][];
  /** Letters of this entry sitting correct on the grid after the reveal. */
  revealed: number;
  /** Length of the entry. */
  total: number;
  /** `true` once every letter of the entry is on the grid. */
  complete: boolean;
};

/**
 * Reveals the *next* few letters of an entry instead of the whole word, so the
 * player can keep clicking for more help until the word is complete.
 *
 * `progress` comes from the client because the stored grid lags behind by up to
 * one autosave debounce; using the stale copy would both re-reveal letters the
 * player just typed and overwrite them on save.
 */
export async function revealEntryAction(
  crosswordId: string,
  entryId: string,
  progress: string[][],
): Promise<RevealResult> {
  const empty: RevealResult = {
    ok: false,
    message: "",
    cells: [],
    revealed: 0,
    total: 0,
    complete: false,
  };

  try {
    const user = await requireApprovedUserOrThrow();
    const current = await getCrosswordById(user.id, crosswordId);
    if (!current) return { ...empty, message: "Crossword não encontrado." };

    const entry = current.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return { ...empty, message: "Palavra não encontrada." };

    const { crossword } = current;
    const grid = sanitizeProgress(progress, crossword.width, crossword.height);
    const batch = nextRevealCells(entry, grid);

    if (batch.cells.length === 0) {
      return { ...empty, ...batch, ok: true, message: `"${entry.term}" já está toda revelada.` };
    }

    for (const [row, col, letter] of batch.cells) grid[row][col] = letter;
    await saveProgress(user.id, crosswordId, grid);

    return {
      ...batch,
      ok: true,
      message: batch.complete
        ? `Palavra revelada: "${entry.term}".`
        : `${batch.revealed} de ${batch.total} letras reveladas — clique de novo para mais.`,
    };
  } catch (error) {
    return { ...empty, message: error instanceof Error ? error.message : "Erro inesperado." };
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
