import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";

import { db } from "@/db";
import { sessions, users, type UserRole, type UserStatus } from "@/db/schema";

export const SESSION_COOKIE = "mscw_session";
const SESSION_TTL_DAYS = 30;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
};

/** Sessions are stored hashed so a database dump cannot be replayed. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/* -------------------------------------------------------------------------- */
/*                                  Lifecycle                                 */
/* -------------------------------------------------------------------------- */

/** Server actions / route handlers only — cookies cannot be set during render. */
export async function createSession(userId: string, userAgent?: string | null): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    userAgent: userAgent?.slice(0, 255) ?? null,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  // Opportunistic cleanup; cheap and keeps the table from growing forever.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/** Signs every device out — used after a password change or reset. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/* -------------------------------------------------------------------------- */
/*                                   Reading                                  */
/* -------------------------------------------------------------------------- */

/**
 * `cache()` dedupes the lookup within a single request, so a layout and its
 * page share one database round-trip. Reading straight from `users` (rather
 * than from a JWT) is what makes an admin approval take effect immediately.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
});

/* -------------------------------------------------------------------------- */
/*                                   Guards                                   */
/* -------------------------------------------------------------------------- */

/** Signed in, whatever the approval status. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Signed in **and** approved by an admin. */
export async function requireApprovedUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.status !== "approved") redirect("/pending");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireApprovedUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

/* --- Throwing variants: use these inside server actions, never the redirecting
       ones, so a failed guard surfaces as a form error instead of an opaque
       NEXT_REDIRECT bubbling through the action's catch block. --- */

export async function requireUserOrThrow(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  return user;
}

export async function requireApprovedUserOrThrow(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");
  if (user.status !== "approved") throw new Error("Sua conta ainda não foi aprovada.");
  return user;
}

export async function requireAdminOrThrow(): Promise<SessionUser> {
  const user = await requireApprovedUserOrThrow();
  if (user.role !== "admin") throw new Error("Acesso restrito a administradores.");
  return user;
}
