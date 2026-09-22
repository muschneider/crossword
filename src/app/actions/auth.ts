"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { actionFailure, type ActionState } from "@/lib/action-state";
import { env, isEmailEnabled } from "@/lib/env";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  hashResetToken,
  RESET_RESEND_COOLDOWN_MS,
  RESET_TTL_MINUTES,
} from "@/lib/password-reset";
import {
  fakeVerifyDelay,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "@/lib/password";
import {
  createSession,
  destroyAllSessions,
  destroySession,
  getSessionUser,
  requireUserOrThrow,
} from "@/lib/session";

type AuthState = ActionState;

/* --------------------------------- config --------------------------------- */

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** Same wording for "wrong password" and "unknown e-mail": no account enumeration. */
const INVALID_CREDENTIALS = "E-mail ou senha incorretos.";

const emailSchema = z
  .string()
  .trim()
  .min(1, "Informe o e-mail.")
  .max(254, "E-mail longo demais.")
  .email("E-mail inválido.");

const nameSchema = z
  .string()
  .trim()
  .min(2, "Informe seu nome.")
  .max(80, "Nome longo demais.");

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const failure = actionFailure;

async function currentUserAgent(): Promise<string | null> {
  const headerList = await headers();
  return headerList.get("user-agent");
}

/** Absolute base URL for links inside e-mails. */
async function baseUrl(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host");
  if (!host) return env.APP_URL;
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
}

function safeRedirectPath(value: unknown): string | null {
  const path = typeof value === "string" ? value.trim() : "";
  // Only same-origin absolute paths; blocks `//evil.com` and `https://evil.com`.
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

/* --------------------------------- sign up -------------------------------- */

const signUpSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: z.string(),
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "As senhas não conferem.",
    path: ["passwordConfirmation"],
  });

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  try {
    const parsed = signUpSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      passwordConfirmation: formData.get("passwordConfirmation"),
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

    const strengthIssue = validatePasswordStrength(parsed.data.password);
    if (strengthIssue) return { ok: false, message: strengthIssue };

    const emailNormalized = normalizeEmail(parsed.data.email);
    const passwordHash = await hashPassword(parsed.data.password);

    const inserted = await db
      .insert(users)
      .values({
        name: parsed.data.name,
        email: parsed.data.email.trim(),
        emailNormalized,
        passwordHash,
        role: "user",
        status: "pending",
      })
      .onConflictDoNothing({ target: users.emailNormalized })
      .returning({ id: users.id });

    if (inserted.length === 0) {
      return { ok: false, message: "Já existe uma conta com este e-mail." };
    }

    await createSession(inserted[0].id, await currentUserAgent());
  } catch (error) {
    return failure(error);
  }

  // New accounts always land on the waiting room until an admin approves.
  redirect("/pending");
}

/* --------------------------------- sign in -------------------------------- */

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  let destination = "/dashboard";

  try {
    const parsedEmail = emailSchema.safeParse(formData.get("email"));
    const password = String(formData.get("password") ?? "");

    if (!parsedEmail.success || !password) {
      return { ok: false, message: INVALID_CREDENTIALS };
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, normalizeEmail(parsedEmail.data)))
      .limit(1);

    if (!user) {
      // Spend the same CPU as a real check so timing does not leak existence.
      await fakeVerifyDelay();
      return { ok: false, message: INVALID_CREDENTIALS };
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      return {
        ok: false,
        message: `Muitas tentativas. Tente novamente em ${minutes} minuto(s) ou redefina sua senha.`,
      };
    }

    const valid = await verifyPassword(password, user.passwordHash);

    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      await db
        .update(users)
        .set({
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return {
        ok: false,
        message: shouldLock
          ? `Muitas tentativas. Sua conta ficou bloqueada por ${LOCK_MINUTES} minutos.`
          : INVALID_CREDENTIALS,
      };
    }

    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await createSession(user.id, await currentUserAgent());

    const requested = safeRedirectPath(formData.get("callbackUrl"));
    destination = user.status === "approved" ? (requested ?? "/dashboard") : "/pending";
  } catch (error) {
    return failure(error);
  }

  redirect(destination);
}

/* -------------------------------- sign out -------------------------------- */

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/* ----------------------------- forgot password ---------------------------- */

export async function requestPasswordResetAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  // Deliberately identical whether or not the account exists.
  const genericSuccess: AuthState = {
    ok: true,
    message:
      "Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha. " +
      "Confira também a caixa de spam.",
  };

  try {
    const parsed = emailSchema.safeParse(formData.get("email"));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

    if (!isEmailEnabled) {
      return {
        ok: false,
        message: "Recuperação de senha indisponível: SMTP não configurado no servidor.",
      };
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, normalizeEmail(parsed.data)))
      .limit(1);

    if (!user) return genericSuccess;

    // Cooldown: ignore rapid repeats so the mailbox cannot be flooded.
    const [recent] = await db
      .select({ createdAt: passwordResetTokens.createdAt })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
          gt(
            passwordResetTokens.createdAt,
            new Date(Date.now() - RESET_RESEND_COOLDOWN_MS),
          ),
        ),
      )
      .limit(1);

    if (recent) return genericSuccess;

    // Any previous link becomes invalid.
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

    const token = randomBytes(32).toString("base64url");
    await db.insert(passwordResetTokens).values({
      tokenHash: hashResetToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
    });

    const url = `${await baseUrl()}/reset-password?token=${token}`;
    await sendPasswordResetEmail(user.email, user.name, url, RESET_TTL_MINUTES);

    return genericSuccess;
  } catch (error) {
    console.error("[auth] password reset request failed:", error);
    return {
      ok: false,
      message: "Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.",
    };
  }
}

/* ------------------------------ reset password ---------------------------- */

const resetSchema = z
  .object({
    token: z.string().min(1, "Link inválido."),
    password: z.string(),
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "As senhas não conferem.",
    path: ["passwordConfirmation"],
  });

export async function resetPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const parsed = resetSchema.safeParse({
      token: formData.get("token"),
      password: formData.get("password"),
      passwordConfirmation: formData.get("passwordConfirmation"),
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

    const strengthIssue = validatePasswordStrength(parsed.data.password);
    if (strengthIssue) return { ok: false, message: strengthIssue };

    const tokenHash = hashResetToken(parsed.data.token);
    const [row] = await db
      .select({
        userId: passwordResetTokens.userId,
        expiresAt: passwordResetTokens.expiresAt,
        usedAt: passwordResetTokens.usedAt,
      })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row || row.usedAt || row.expiresAt <= new Date()) {
      return { ok: false, message: "Link inválido, expirado ou já utilizado." };
    }

    const passwordHash = await hashPassword(parsed.data.password);

    await db.batch([
      db
        .update(users)
        .set({
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, row.userId)),
      db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.tokenHash, tokenHash)),
    ]);

    // A reset invalidates every device — that is the point if the account was
    // compromised.
    await destroyAllSessions(row.userId);
  } catch (error) {
    return failure(error);
  }

  redirect("/login?reset=1");
}

/* ----------------------------- change password ---------------------------- */

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual."),
    password: z.string(),
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "As senhas não conferem.",
    path: ["passwordConfirmation"],
  });

export async function changePasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const sessionUser = await requireUserOrThrow();

    const parsed = changeSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      password: formData.get("password"),
      passwordConfirmation: formData.get("passwordConfirmation"),
    });
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

    const strengthIssue = validatePasswordStrength(parsed.data.password);
    if (strengthIssue) return { ok: false, message: strengthIssue };

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, sessionUser.id))
      .limit(1);

    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return { ok: false, message: "Senha atual incorreta." };
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(parsed.data.password), updatedAt: new Date() })
      .where(eq(users.id, sessionUser.id));

    // Drop every session (including this one) and issue a fresh one.
    await destroyAllSessions(sessionUser.id);
    await createSession(sessionUser.id, await currentUserAgent());

    return { ok: true, message: "Senha alterada. Os outros dispositivos foram desconectados." };
  } catch (error) {
    return failure(error);
  }
}

/* -------------------------------- profile --------------------------------- */

export async function updateProfileAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const sessionUser = await requireUserOrThrow();

    const parsed = nameSchema.safeParse(formData.get("name"));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

    await db
      .update(users)
      .set({ name: parsed.data, updatedAt: new Date() })
      .where(eq(users.id, sessionUser.id));

    return { ok: true, message: "Nome atualizado." };
  } catch (error) {
    return failure(error);
  }
}

/** Used by the waiting room to poll for approval without a full reload. */
export async function checkApprovalAction(): Promise<{ status: string | null }> {
  const user = await getSessionUser();
  return { status: user?.status ?? null };
}
