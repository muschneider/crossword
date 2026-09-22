"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, count } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users, type UserRole, type UserStatus } from "@/db/schema";
import { actionFailure, type ActionState } from "@/lib/action-state";
import { sendAccountApprovedEmail } from "@/lib/email";
import { env, isEmailEnabled } from "@/lib/env";
import { destroyAllSessions, requireAdminOrThrow } from "@/lib/session";

type AdminActionState = ActionState;

const idSchema = z.string().uuid();
const statusSchema = z.enum(["pending", "approved", "rejected"]);
const roleSchema = z.enum(["user", "admin"]);

const failure = actionFailure;

/** Refuses to leave the instance without a single approved admin. */
async function assertNotLastAdmin(userId: string) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "approved"), ne(users.id, userId)));

  if (total === 0) {
    throw new Error("Não é possível remover o último administrador ativo.");
  }
}

export async function setUserStatusAction(
  userId: string,
  status: UserStatus,
): Promise<AdminActionState> {
  try {
    const admin = await requireAdminOrThrow();

    if (!idSchema.safeParse(userId).success || !statusSchema.safeParse(status).success) {
      return { ok: false, message: "Parâmetros inválidos." };
    }
    if (userId === admin.id && status !== "approved") {
      return { ok: false, message: "Você não pode revogar o próprio acesso." };
    }
    if (status !== "approved") await assertNotLastAdmin(userId);

    const updated = await db
      .update(users)
      .set({
        status,
        approvedAt: status === "approved" ? new Date() : null,
        approvedBy: status === "approved" ? admin.email : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ email: users.email, name: users.name });

    if (updated.length === 0) return { ok: false, message: "Usuário não encontrado." };

    // Losing access must take effect immediately, not on the next login.
    if (status !== "approved") await destroyAllSessions(userId);

    revalidatePath("/admin/users");

    const label =
      status === "approved"
        ? "aprovado"
        : status === "rejected"
          ? "recusado"
          : "movido para pendente";

    let suffix = "";
    if (status === "approved" && isEmailEnabled) {
      try {
        await sendAccountApprovedEmail(updated[0].email, updated[0].name, env.APP_URL);
        suffix = " Avisamos por e-mail.";
      } catch (mailError) {
        // Approval already happened; a failed notification must not undo it.
        console.error("[admin] approval e-mail failed:", mailError);
        suffix = " (não foi possível enviar o e-mail de aviso)";
      }
    }

    return { ok: true, message: `${updated[0].email} ${label}.${suffix}` };
  } catch (error) {
    return failure(error);
  }
}

export async function setUserRoleAction(
  userId: string,
  role: UserRole,
): Promise<AdminActionState> {
  try {
    const admin = await requireAdminOrThrow();

    if (!idSchema.safeParse(userId).success || !roleSchema.safeParse(role).success) {
      return { ok: false, message: "Parâmetros inválidos." };
    }
    if (userId === admin.id && role !== "admin") {
      return { ok: false, message: "Você não pode rebaixar a si mesmo." };
    }
    if (role !== "admin") await assertNotLastAdmin(userId);

    const updated = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, userId))
      .returning({ email: users.email });

    if (updated.length === 0) return { ok: false, message: "Usuário não encontrado." };

    revalidatePath("/admin/users");
    return {
      ok: true,
      message: `${updated[0].email} agora é ${role === "admin" ? "administrador" : "usuário comum"}.`,
    };
  } catch (error) {
    return failure(error);
  }
}

/** Removes the account and, by cascade, every word and crossword it owns. */
export async function deleteUserAction(userId: string): Promise<AdminActionState> {
  try {
    const admin = await requireAdminOrThrow();
    if (userId === admin.id) {
      return { ok: false, message: "Você não pode excluir a própria conta." };
    }
    await assertNotLastAdmin(userId);

    const deleted = await db
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ email: users.email });

    if (deleted.length === 0) return { ok: false, message: "Usuário não encontrado." };

    revalidatePath("/admin/users");
    return { ok: true, message: `${deleted[0].email} excluído.` };
  } catch (error) {
    return failure(error);
  }
}
