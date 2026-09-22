/**
 * Account administration from the terminal — the escape hatch when nobody can
 * log in yet (or when SMTP is down).
 *
 *   mise run admin:create   -- --email=voce@gmail.com --name="Seu Nome" [--password=...]
 *   mise run admin:password -- --email=voce@gmail.com [--password=...]
 *   mise run admin:list
 *
 * Omitting --password makes the script generate a strong one and print it once.
 */
import "dotenv/config";

import { randomInt } from "node:crypto";

import { eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../src/db/schema";
import { hashPassword } from "../src/lib/password";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match?.slice(prefix.length);
}

/** Ambiguous characters (O/0, l/1, I) are excluded so the password can be read aloud. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 18): string {
  let password = "";
  for (let i = 0; i < length; i += 1) password += ALPHABET[randomInt(ALPHABET.length)];
  // Guarantee the letter+digit rule from validatePasswordStrength().
  return `${password.slice(0, length - 2)}${randomInt(10)}${ALPHABET[randomInt(26)]}`;
}

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return drizzle(neon(url), { schema });
}

async function list() {
  const rows = await db()
    .select({
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      status: schema.users.status,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users);

  if (rows.length === 0) {
    console.log("Nenhum usuário cadastrado.");
    return;
  }
  console.table(
    rows.map((row) => ({
      email: row.email,
      nome: row.name,
      papel: row.role,
      situação: row.status,
      criado: row.createdAt.toISOString().slice(0, 10),
    })),
  );
}

async function create() {
  const email = arg("email");
  if (!email) throw new Error("Informe --email=<conta>.");

  const name = arg("name") ?? email.split("@")[0];
  const password = arg("password") ?? generatePassword();
  const generated = !arg("password");
  const emailNormalized = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const connection = db();

  const [existing] = await connection
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.emailNormalized, emailNormalized))
    .limit(1);

  if (existing) {
    // Idempotent: promote + approve + reset the password of an existing account.
    await connection
      .update(schema.users)
      .set({
        name,
        passwordHash,
        role: "admin",
        status: "approved",
        approvedAt: new Date(),
        approvedBy: "cli",
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existing.id));
    console.log(`Conta existente promovida a admin: ${email}`);
  } else {
    await connection.insert(schema.users).values({
      name,
      email: email.trim(),
      emailNormalized,
      passwordHash,
      role: "admin",
      status: "approved",
      approvedAt: new Date(),
      approvedBy: "cli",
    });
    console.log(`Admin criado: ${email}`);
  }

  if (generated) {
    console.log("\n  ┌───────────────────────────────────────────────┐");
    console.log(`    senha: ${password}`);
    console.log("  └───────────────────────────────────────────────┘");
    console.log("\n  Guarde agora — ela não será exibida novamente.");
  }
}

async function setPassword() {
  const email = arg("email");
  if (!email) throw new Error("Informe --email=<conta>.");

  const password = arg("password") ?? generatePassword();
  const generated = !arg("password");
  const connection = db();

  const updated = await connection
    .update(schema.users)
    .set({
      passwordHash: await hashPassword(password),
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.emailNormalized, email.trim().toLowerCase()))
    .returning({ id: schema.users.id });

  if (updated.length === 0) {
    console.error(`Usuário "${email}" não encontrado.`);
    process.exit(1);
  }

  // A password reset must invalidate every open session.
  await connection.delete(schema.sessions).where(eq(schema.sessions.userId, updated[0].id));

  console.log(`Senha redefinida para ${email} e sessões encerradas.`);
  if (generated) console.log(`\n  senha: ${password}\n`);
}

const commands: Record<string, () => Promise<void>> = {
  create,
  password: setPassword,
  list,
};

async function main() {
  const command = process.argv[2];
  const handler = commands[command ?? ""];
  if (!handler) {
    console.error(`Uso: tsx scripts/admin.ts <${Object.keys(commands).join("|")}> [--email=...]`);
    process.exit(1);
  }
  await handler();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
