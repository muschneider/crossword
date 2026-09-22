/**
 * End-to-end verification against the real Neon database.
 * Creates throwaway users, exercises every business rule, then deletes
 * everything it created.
 *
 *   mise run test:e2e
 */
import "dotenv/config";

import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import { db } from "../src/db";
import {
  crosswordEntries,
  crosswords,
  passwordResetTokens,
  sessions,
  users,
  words,
} from "../src/db/schema";
import {
  checkGrid,
  completeCrossword,
  deleteCrossword,
  generateCrosswordForUser,
  getActiveCrossword,
  getCurrentCrossword,
} from "../src/lib/crossword/service";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../src/lib/password";
import { parseWordList } from "../src/lib/words";

const stamp = Date.now();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function createUser(suffix: string, password: string, overrides = {}) {
  const email = `e2e-${suffix}-${stamp}@example.test`;
  const [row] = await db
    .insert(users)
    .values({
      name: `E2E ${suffix}`,
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      status: "approved",
      ...overrides,
    })
    .returning({ id: users.id });
  return { id: row.id, email };
}

async function main() {
  const password = "Senha-Forte-123";
  const user = await createUser("main", password);
  const other = await createUser("other", password);
  console.log(`✓ usuários criados (${user.email}, ${other.email})`);

  try {
    /* ============================== AUTH ================================= */

    const [stored] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id));

    assert.ok(stored.passwordHash.startsWith("scrypt$"), "formato de hash inesperado");
    assert.ok(!stored.passwordHash.includes(password), "senha vazou no hash");
    assert.equal(await verifyPassword(password, stored.passwordHash), true);
    assert.equal(await verifyPassword("senha-errada", stored.passwordHash), false);
    assert.equal(await verifyPassword(`${password} `, stored.passwordHash), false);
    console.log("✓ hash scrypt: senha correta aceita, variações rejeitadas");

    const hashA = await hashPassword(password);
    const hashB = await hashPassword(password);
    assert.notEqual(hashA, hashB, "salt não está sendo aleatorizado");
    assert.equal(await verifyPassword(password, hashA), true);
    assert.equal(await verifyPassword(password, hashB), true);
    console.log("✓ salt aleatório por hash (hashes distintos, ambos válidos)");

    assert.equal(validatePasswordStrength("curta1"), "A senha precisa ter pelo menos 8 caracteres.");
    assert.equal(
      validatePasswordStrength("somenteletras"),
      "A senha precisa misturar letras e números.",
    );
    assert.equal(validatePasswordStrength("Senha-Forte-123"), null);
    console.log("✓ política de senha");

    assert.equal(await verifyPassword(password, "lixo"), false);
    assert.equal(await verifyPassword(password, "scrypt$a$b$c$d$e"), false);
    console.log("✓ hash corrompido não derruba a verificação");

    // Sessions are stored hashed and cascade on user deletion.
    const rawToken = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({
      tokenHash: hashToken(rawToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(rawToken)));
    assert.ok(sessionRow, "sessão não gravada");
    assert.notEqual(sessionRow.tokenHash, rawToken, "token guardado em texto puro");
    console.log("✓ sessão guardada como SHA-256, nunca o token bruto");

    // Reset token lifecycle.
    const resetToken = randomBytes(32).toString("base64url");
    await db.insert(passwordResetTokens).values({
      tokenHash: hashToken(resetToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [tokenRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashToken(resetToken)));
    assert.ok(tokenRow && !tokenRow.usedAt, "token de reset inválido");
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.tokenHash, hashToken(resetToken)));
    const [usedRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashToken(resetToken)));
    assert.ok(usedRow.usedAt, "token não marcado como usado");
    console.log("✓ token de recuperação: criado, hasheado e marcável como usado");

    // Unique e-mail per account.
    await assert.rejects(
      () =>
        db.insert(users).values({
          name: "Duplicado",
          email: user.email.toUpperCase(),
          emailNormalized: user.email.toLowerCase(),
          passwordHash: "x",
        }),
      /users_email_normalized_uq|duplicate key/i,
      "permitiu e-mail duplicado",
    );
    console.log("✓ e-mail único por conta (case-insensitive)");

    /* ========================== WORDS & DEDUPE =========================== */

    const file = readFileSync("data/seed-words.txt", "utf8");
    const parsed = parseWordList(`${file}\n${file}`); // duplicate the whole list on purpose
    assert.equal(parsed.words.length, 15, "dedupe dentro da lista falhou");
    assert.equal(parsed.duplicatesInInput.length, 15);
    console.log("✓ dedupe dentro da lista colada (15 únicas, 15 descartadas)");

    const rows = parsed.words.map((word) => ({ userId: user.id, ...word }));
    const firstInsert = await db
      .insert(words)
      .values(rows)
      .onConflictDoNothing({ target: [words.userId, words.normalized] })
      .returning({ id: words.id });
    const secondInsert = await db
      .insert(words)
      .values(rows)
      .onConflictDoNothing({ target: [words.userId, words.normalized] })
      .returning({ id: words.id });

    assert.equal(firstInsert.length, 15);
    assert.equal(secondInsert.length, 0, "dedupe entre importações falhou");
    console.log("✓ dedupe entre importações diferentes (0 duplicadas gravadas)");

    // The same word must be allowed for a *different* user.
    const otherInsert = await db
      .insert(words)
      .values(parsed.words.map((word) => ({ userId: other.id, ...word })))
      .onConflictDoNothing({ target: [words.userId, words.normalized] })
      .returning({ id: words.id });
    assert.equal(otherInsert.length, 15, "vocabulário não é isolado por usuário");
    console.log("✓ vocabulários isolados por usuário (mesma palavra em duas contas)");

    /* ============================= CROSSWORD ============================= */

    const first = await generateCrosswordForUser(user.id);
    const active = await getActiveCrossword(user.id);
    assert.ok(active, "crossword ativo não encontrado");
    assert.equal(active.crossword.id, first.id);
    console.log(
      `✓ crossword gerado: ${active.crossword.width}x${active.crossword.height}, ` +
        `${active.entries.length} palavras`,
    );

    const aiClues = active.entries.filter((entry) => entry.clueSource === "ai").length;
    const ptClues = active.entries.length - aiClues;
    console.log(`  dicas: ${aiClues} por IA, ${ptClues} por tradução`);
    assert.ok(aiClues > 0, "nenhuma dica de IA gerada");
    assert.ok(ptClues > 0, "nenhuma dica de tradução");

    for (const entry of active.entries) {
      assert.ok(entry.clue.trim().length > 0, `dica vazia em ${entry.term}`);
      if (entry.clueSource === "ai") {
        assert.ok(entry.clue.includes("_____"), `dica de IA sem lacuna: ${entry.clue}`);
      }
      const dr = entry.direction === "down" ? 1 : 0;
      const dc = entry.direction === "across" ? 1 : 0;
      for (let i = 0; i < entry.answer.length; i += 1) {
        assert.equal(
          active.crossword.grid[entry.row + dr * i][entry.col + dc * i],
          entry.answer[i],
          `grid divergente em ${entry.term}`,
        );
      }
    }
    console.log("✓ grid consistente com todas as entradas");

    const used = await db.select().from(words).where(eq(words.userId, user.id));
    const usedOnce = used.filter((word) => word.usageCount === 1);
    assert.equal(usedOnce.length, active.entries.length, "contador de uso inconsistente");
    const otherUntouched = await db.select().from(words).where(eq(words.userId, other.id));
    assert.ok(
      otherUntouched.every((word) => word.usageCount === 0),
      "geração afetou o vocabulário de outro usuário",
    );
    console.log(`✓ ${usedOnce.length} palavras marcadas como usadas, nenhuma de outro usuário`);

    await assert.rejects(
      () => generateCrosswordForUser(user.id),
      /já tem um crossword em andamento/i,
      "permitiu dois crosswords ativos",
    );
    console.log("✓ bloqueio de segundo crossword simultâneo");

    const partial = active.crossword.grid.map((row) => row.map(() => ""));
    assert.equal(checkGrid(active.crossword.grid, partial, active.entries).solved, false);

    const solution = active.crossword.grid.map((row) => row.map((cell) => cell ?? ""));
    await db
      .update(crosswords)
      .set({ progress: solution })
      .where(eq(crosswords.id, active.crossword.id));

    await completeCrossword(user.id, active.crossword.id);
    assert.equal(await getActiveCrossword(user.id), null, "crossword continuou ativo");
    console.log("✓ conclusão validada no servidor e slot liberado");

    const current = await getCurrentCrossword(user.id);
    assert.equal(current?.crossword.status, "completed");
    assert.ok(current?.entries.every((entry) => entry.solved));
    console.log("✓ crossword concluído continua visível com as respostas");

    const second = await generateCrosswordForUser(user.id);
    const secondFull = await getActiveCrossword(user.id);
    const firstIds = new Set(active.entries.map((entry) => entry.wordId));
    const reused = secondFull!.entries.filter((entry) => firstIds.has(entry.wordId)).length;
    console.log(
      `✓ segundo crossword gerado: ${secondFull!.entries.length} palavras, ${reused} repetidas`,
    );

    await deleteCrossword(user.id, second.id);
    const leftovers = await db
      .select()
      .from(crosswordEntries)
      .where(eq(crosswordEntries.crosswordId, second.id));
    assert.equal(leftovers.length, 0, "entries órfãs após remoção");
    console.log("✓ remoção do crossword faz cascade nas entradas");

    assert.ok((await generateCrosswordForUser(user.id)).id);
    console.log("✓ novo crossword liberado após remoção");
  } finally {
    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(users).where(eq(users.id, other.id));

    const orphanWords = await db.select().from(words).where(eq(words.userId, user.id));
    const orphanCrosswords = await db.select().from(crosswords).where(eq(crosswords.userId, user.id));
    const orphanSessions = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    const orphanTokens = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id));

    assert.equal(orphanWords.length, 0);
    assert.equal(orphanCrosswords.length, 0);
    assert.equal(orphanSessions.length, 0);
    assert.equal(orphanTokens.length, 0);
    console.log("✓ limpeza: cascade apagou palavras, crosswords, sessões e tokens");
  }
}

main().catch((error) => {
  console.error("\n✗ FALHOU:", error);
  process.exit(1);
});
