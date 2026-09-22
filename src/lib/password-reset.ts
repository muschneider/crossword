import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";

export const RESET_TTL_MINUTES = 30;
export const RESET_RESEND_COOLDOWN_MS = 60_000;

/** Only the hash is persisted, so a database dump yields no usable links. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ResetTokenCheck =
  | { valid: true; name: string; email: string }
  | { valid: false; reason: string };

export async function inspectResetToken(token: string): Promise<ResetTokenCheck> {
  if (!token) return { valid: false, reason: "Link inválido." };

  const [row] = await db
    .select({
      name: users.name,
      email: users.email,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.tokenHash, hashResetToken(token)))
    .limit(1);

  if (!row) return { valid: false, reason: "Link inválido ou já utilizado." };
  if (row.usedAt) return { valid: false, reason: "Este link já foi utilizado." };
  if (row.expiresAt <= new Date()) return { valid: false, reason: "Este link expirou." };

  return { valid: true, name: row.name, email: row.email };
}
