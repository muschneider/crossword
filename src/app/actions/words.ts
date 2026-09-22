"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { words, type NewWord } from "@/db/schema";
import { actionFailure, type ActionState } from "@/lib/action-state";
import { requireApprovedUserOrThrow } from "@/lib/session";
import { collapseSpaces, normalizeTerm, parseWordList, toAnswer } from "@/lib/words";

function revalidateWordPages() {
  revalidatePath("/words");
  revalidatePath("/dashboard");
}

const failure = actionFailure;

/* -------------------------------------------------------------------------- */
/*                                   Import                                   */
/* -------------------------------------------------------------------------- */

const CHUNK_SIZE = 400;

export async function importWordsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApprovedUserOrThrow();

    const raw = String(formData.get("content") ?? "");
    if (!raw.trim()) {
      return { ok: false, message: "Cole ao menos uma linha de palavras." };
    }

    const parsed = parseWordList(raw);
    if (parsed.words.length === 0) {
      return {
        ok: false,
        message: "Nenhuma linha válida encontrada.",
        details: parsed.issues.slice(0, 10).map((i) => `Linha ${i.line}: ${i.reason} — ${i.content}`),
      };
    }

    const rows: NewWord[] = parsed.words.map((word) => ({
      userId: user.id,
      term: word.term,
      normalized: word.normalized,
      answer: word.answer,
      translation: word.translation,
    }));

    let insertedCount = 0;
    for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
      const inserted = await db
        .insert(words)
        .values(rows.slice(offset, offset + CHUNK_SIZE))
        // Per-user uniqueness: re-sending the same word is a no-op.
        .onConflictDoNothing({ target: [words.userId, words.normalized] })
        .returning({ id: words.id });
      insertedCount += inserted.length;
    }

    const alreadyExisting = parsed.words.length - insertedCount;
    const details: string[] = [];

    if (alreadyExisting > 0) {
      details.push(`${alreadyExisting} já existiam no seu vocabulário e foram ignoradas.`);
    }
    if (parsed.duplicatesInInput.length > 0) {
      details.push(
        `${parsed.duplicatesInInput.length} duplicadas dentro da lista colada: ` +
          `${parsed.duplicatesInInput.slice(0, 8).join(", ")}` +
          (parsed.duplicatesInInput.length > 8 ? "…" : ""),
      );
    }
    for (const issue of parsed.issues.slice(0, 8)) {
      details.push(`Linha ${issue.line} ignorada: ${issue.reason} — ${issue.content}`);
    }
    if (parsed.issues.length > 8) {
      details.push(`…e mais ${parsed.issues.length - 8} linha(s) com problema.`);
    }

    revalidateWordPages();

    return {
      ok: true,
      message:
        insertedCount > 0
          ? `${insertedCount} palavra(s) adicionada(s).`
          : "Nenhuma palavra nova — tudo já estava cadastrado.",
      details,
    };
  } catch (error) {
    return failure(error);
  }
}

/* -------------------------------------------------------------------------- */
/*                                Create / update                             */
/* -------------------------------------------------------------------------- */

const wordSchema = z.object({
  term: z
    .string()
    .trim()
    .min(1, "Informe o termo em inglês.")
    .max(120, "Termo longo demais.")
    .refine((value) => toAnswer(value).length >= 1, "O termo precisa conter letras (A-Z)."),
  translation: z
    .string()
    .trim()
    .min(1, "Informe a tradução em português.")
    .max(300, "Tradução longa demais."),
});

export async function createWordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApprovedUserOrThrow();

    const parsed = wordSchema.safeParse({
      term: formData.get("term"),
      translation: formData.get("translation"),
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0].message };
    }

    const term = collapseSpaces(parsed.data.term);
    const inserted = await db
      .insert(words)
      .values({
        userId: user.id,
        term,
        normalized: normalizeTerm(term),
        answer: toAnswer(term),
        translation: collapseSpaces(parsed.data.translation),
      })
      .onConflictDoNothing({ target: [words.userId, words.normalized] })
      .returning({ id: words.id });

    if (inserted.length === 0) {
      return { ok: false, message: `"${term}" já está no seu vocabulário.` };
    }

    revalidateWordPages();
    return { ok: true, message: `"${term}" adicionada.` };
  } catch (error) {
    return failure(error);
  }
}

export async function updateWordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApprovedUserOrThrow();

    const id = String(formData.get("id") ?? "");
    if (!z.string().uuid().safeParse(id).success) {
      return { ok: false, message: "Palavra inválida." };
    }

    const parsed = wordSchema.safeParse({
      term: formData.get("term"),
      translation: formData.get("translation"),
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0].message };
    }

    const term = collapseSpaces(parsed.data.term);
    const normalized = normalizeTerm(term);

    // Renaming into an existing word would break the per-user unique index.
    const clash = await db
      .select({ id: words.id })
      .from(words)
      .where(and(eq(words.userId, user.id), eq(words.normalized, normalized)))
      .limit(1);

    if (clash.length > 0 && clash[0].id !== id) {
      return { ok: false, message: `"${term}" já existe no seu vocabulário.` };
    }

    const updated = await db
      .update(words)
      .set({
        term,
        normalized,
        answer: toAnswer(term),
        translation: collapseSpaces(parsed.data.translation),
        updatedAt: new Date(),
      })
      .where(and(eq(words.id, id), eq(words.userId, user.id)))
      .returning({ id: words.id });

    if (updated.length === 0) return { ok: false, message: "Palavra não encontrada." };

    revalidateWordPages();
    return { ok: true, message: "Palavra atualizada." };
  } catch (error) {
    return failure(error);
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Delete                                   */
/* -------------------------------------------------------------------------- */

export async function deleteWordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApprovedUserOrThrow();

    const id = String(formData.get("id") ?? "");
    if (!z.string().uuid().safeParse(id).success) {
      return { ok: false, message: "Palavra inválida." };
    }

    const deleted = await db
      .delete(words)
      .where(and(eq(words.id, id), eq(words.userId, user.id)))
      .returning({ term: words.term });

    if (deleted.length === 0) return { ok: false, message: "Palavra não encontrada." };

    revalidateWordPages();
    return { ok: true, message: `"${deleted[0].term}" removida.` };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteWordsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireApprovedUserOrThrow();

    const ids = formData
      .getAll("ids")
      .map(String)
      .filter((id) => z.string().uuid().safeParse(id).success);

    if (ids.length === 0) return { ok: false, message: "Selecione ao menos uma palavra." };

    const deleted = await db
      .delete(words)
      .where(and(eq(words.userId, user.id), inArray(words.id, ids)))
      .returning({ id: words.id });

    revalidateWordPages();
    return { ok: true, message: `${deleted.length} palavra(s) removida(s).` };
  } catch (error) {
    return failure(error);
  }
}

/** Puts every word back in the rotation (usage counters reset to zero). */
export async function resetUsageAction(): Promise<ActionState> {
  try {
    const user = await requireApprovedUserOrThrow();
    await db
      .update(words)
      .set({ usageCount: 0, lastUsedAt: null, updatedAt: new Date() })
      .where(eq(words.userId, user.id));

    revalidateWordPages();
    return { ok: true, message: "Contadores de uso zerados." };
  } catch (error) {
    return failure(error);
  }
}
