/**
 * Bulk-imports a vocabulary file into a user's account.
 *
 *   mise run seed:words -- --email=you@gmail.com
 *   mise run seed:words -- --email=you@gmail.com --file=./my-list.txt
 *
 * Words are per-user, so the target account must already exist (create it from
 * the sign-up screen or with `mise run admin:create`). Re-running is safe:
 * duplicates are ignored.
 */
import "dotenv/config";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../src/db/schema";
import { parseWordList } from "../src/lib/words";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match?.slice(prefix.length);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const email = arg("email")?.toLowerCase();
  const file = resolve(process.cwd(), arg("file") ?? "data/seed-words.txt");

  const db = drizzle(neon(url), { schema });

  const allUsers = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users);

  if (allUsers.length === 0) {
    throw new Error(
      "Nenhum usuário cadastrado. Crie a conta em /signup ou rode: mise run admin:create -- --email=...",
    );
  }

  const target = email
    ? allUsers.find((user) => user.email?.toLowerCase() === email)
    : allUsers.length === 1
      ? allUsers[0]
      : undefined;

  if (!target) {
    console.error(
      email
        ? `Usuário "${email}" não encontrado.`
        : "Há mais de um usuário; informe --email=<conta>.",
    );
    console.error("Contas disponíveis:");
    for (const user of allUsers) console.error(`  - ${user.email}`);
    process.exit(1);
  }

  const parsed = parseWordList(readFileSync(file, "utf8"));
  console.log(`Arquivo: ${file}`);
  console.log(`Linhas válidas: ${parsed.words.length}`);
  for (const issue of parsed.issues) {
    console.warn(`  ! linha ${issue.line}: ${issue.reason} — ${issue.content}`);
  }
  if (parsed.duplicatesInInput.length > 0) {
    console.warn(`  duplicadas no arquivo (ignoradas): ${parsed.duplicatesInInput.join(", ")}`);
  }
  if (parsed.words.length === 0) process.exit(1);

  const inserted = await db
    .insert(schema.words)
    .values(
      parsed.words.map((word) => ({
        userId: target.id,
        term: word.term,
        normalized: word.normalized,
        answer: word.answer,
        translation: word.translation,
      })),
    )
    .onConflictDoNothing({ target: [schema.words.userId, schema.words.normalized] })
    .returning({ term: schema.words.term });

  const [{ total }] = await db
    .select({ total: schema.words.id })
    .from(schema.words)
    .where(eq(schema.words.userId, target.id))
    .then((rows) => [{ total: rows.length }]);

  console.log(`\n${inserted.length} nova(s) palavra(s) para ${target.email}.`);
  console.log(`${parsed.words.length - inserted.length} já existia(m).`);
  console.log(`Total no vocabulário: ${total}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
