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
import { countGiven } from "../src/lib/crossword/difficulty";
import {
  applyGivens,
  checkGrid,
  completeCrossword,
  deleteCrossword,
  entryOutcome,
  generateCrosswordForUser,
  getActiveCrossword,
  getCurrentCrossword,
  markTranslationUsed,
} from "../src/lib/crossword/service";
import { isAiEnabled } from "../src/lib/env";
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

    const first = await generateCrosswordForUser(user.id, "easy");
    const active = await getActiveCrossword(user.id);
    assert.ok(active, "crossword ativo não encontrado");
    assert.equal(active.crossword.id, first.crossword.id);
    assert.equal(active.crossword.difficulty, "easy");
    console.log(
      `✓ crossword fácil gerado: ${active.crossword.width}x${active.crossword.height}, ` +
        `${active.entries.length} palavras`,
    );

    const english = active.entries.filter((entry) =>
      ["simple", "definition", "crossword"].includes(entry.clueSource),
    );
    console.log(
      `  dicas: ${english.length} em inglês, ${first.fallbackClues} caíram para o português`,
    );
    for (const entry of english) console.log(`    ${entry.term.padEnd(18)} ${entry.clue}`);
    if (isAiEnabled) {
      // A fresh vocabulary sits at level 0: every clue should be a simple English one.
      assert.ok(english.length >= active.entries.length * 0.75, "dicas em português demais");
      assert.ok(
        english.every((entry) => entry.clueSource === "simple"),
        "palavra no nível 0 deveria receber a explicação simples",
      );
    }

    for (const entry of active.entries) {
      assert.ok(entry.clue.trim().length > 0, `dica vazia em ${entry.term}`);
      assert.ok(!/_{2,}/.test(entry.clue), `dica com lacuna para completar: ${entry.clue}`);
      assert.notEqual(entry.clueSource, "sentence", "o estilo de frase com lacuna foi aposentado");
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
    console.log("✓ grid consistente com todas as entradas, nenhuma dica com lacuna");

    /* ------------------------ letras dadas ------------------------ */

    const givens = active.crossword.givens;
    const playable = active.crossword.grid.flat().filter((cell) => cell !== null).length;
    assert.ok(givens.length >= playable * 0.3, `fácil com poucas letras: ${givens.length}/${playable}`);
    for (const [row, col] of givens) {
      assert.equal(
        active.crossword.progress[row][col],
        active.crossword.grid[row][col],
        "letra dada não começou no grid",
      );
    }
    const freeEntries = active.entries.filter(
      (entry) => countGiven(entry, givens) === entry.answer.length,
    );
    assert.equal(freeEntries.length, 1, "o fácil deve trazer exatamente uma palavra pronta");
    const freeEntry = freeEntries[0];
    console.log(
      `✓ fácil: ${givens.length}/${playable} letras dadas, palavra pronta: "${freeEntry.term}"`,
    );

    const erased = applyGivens(
      active.crossword.grid.map((row) => row.map(() => "")),
      active.crossword,
    );
    assert.ok(
      givens.every(([row, col]) => erased[row][col] === active.crossword.grid[row][col]),
      "letra dada pôde ser apagada",
    );
    console.log("✓ letras dadas são travadas: o servidor as regrava em todo progresso");

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

    /* ---------------------- repetição espaçada ---------------------- */

    // Simula o que o jogador faria: uma palavra resolvida sozinha, outra
    // inteiramente revelada pelo botão de dica, e uma terceira em que ele olhou
    // a tradução em português antes de acertar.
    const scorable = active.entries.filter(
      (entry) => entryOutcome(entry, givens) === "clean" && entry.id !== freeEntry.id,
    );
    assert.ok(scorable.length >= 2, "o fácil não deixou palavras pontuáveis sem ajuda");
    const [cleanEntry, peekedEntry] = scorable;
    const helpedEntry = active.entries.find(
      (entry) =>
        entry.id !== cleanEntry.id &&
        entry.id !== peekedEntry.id &&
        entry.id !== freeEntry.id &&
        entry.answer.length >= 4,
    )!;
    await db
      .update(crosswordEntries)
      .set({ revealedCount: helpedEntry.answer.length })
      .where(eq(crosswordEntries.id, helpedEntry.id));
    await markTranslationUsed(active.crossword.id, peekedEntry.id);

    const before = new Map(
      (await db.select().from(words).where(eq(words.userId, user.id))).map((word) => [
        word.id,
        word,
      ]),
    );

    const solution = active.crossword.grid.map((row) => row.map((cell) => cell ?? ""));
    await db
      .update(crosswords)
      .set({ progress: solution })
      .where(eq(crosswords.id, active.crossword.id));

    await completeCrossword(user.id, active.crossword.id);
    assert.equal(await getActiveCrossword(user.id), null, "crossword continuou ativo");
    console.log("✓ conclusão validada no servidor e slot liberado");

    const scored = await db.select().from(words).where(eq(words.userId, user.id));
    const byId = new Map(scored.map((word) => [word.id, word]));

    const promoted = byId.get(cleanEntry.wordId!)!;
    assert.equal(promoted.level, before.get(promoted.id)!.level + 1, "palavra limpa não subiu");
    assert.equal(promoted.streak, 1, "streak não contabilizado");
    assert.equal(promoted.correctCount, 1);
    assert.ok(promoted.dueAt && promoted.dueAt > new Date(), "palavra limpa sem próxima revisão");

    const demoted = byId.get(helpedEntry.wordId!)!;
    assert.equal(demoted.level, 0, "palavra revelada não foi rebaixada");
    assert.equal(demoted.missCount, 1);
    assert.ok(
      demoted.dueAt! <= promoted.dueAt!,
      "palavra revelada deveria voltar antes da acertada",
    );

    const peeked = byId.get(peekedEntry.wordId!)!;
    assert.equal(peeked.level, before.get(peeked.id)!.level, "tradução usada não pode promover");
    assert.equal(peeked.missCount, 1, "tradução usada deveria contar como ajuda");

    const free = byId.get(freeEntry.wordId!)!;
    const freeBefore = before.get(free.id)!;
    assert.equal(free.level, freeBefore.level, "a palavra grátis não pode ser pontuada");
    assert.equal(free.missCount, freeBefore.missCount);
    assert.equal(free.correctCount, freeBefore.correctCount);
    assert.deepEqual(free.dueAt, freeBefore.dueAt, "a agenda da palavra grátis não pode mudar");

    assert.ok(
      scored.every((word) => word.usageCount === 0 || word.dueAt !== null || word.id === free.id),
      "palavra usada ficou sem agenda de revisão",
    );

    const untouchedByScoring = await db.select().from(words).where(eq(words.userId, other.id));
    assert.ok(
      untouchedByScoring.every((word) => word.level === 0 && word.dueAt === null),
      "pontuação vazou para o vocabulário de outro usuário",
    );
    console.log(
      `✓ desempenho realimentado: "${promoted.term}" subiu para nível ${promoted.level}, ` +
        `"${demoted.term}" caiu para 0, "${peeked.term}" (viu a tradução) ficou, ` +
        `"${free.term}" (grátis) não foi pontuada`,
    );

    const current = await getCurrentCrossword(user.id);
    assert.equal(current?.crossword.status, "completed");
    assert.ok(current?.entries.every((entry) => entry.solved));
    console.log("✓ crossword concluído continua visível com as respostas");

    const second = await generateCrosswordForUser(user.id, "hard");
    const secondFull = await getActiveCrossword(user.id);
    assert.equal(secondFull!.crossword.difficulty, "hard");
    assert.equal(secondFull!.crossword.givens.length, 0, "o difícil não pode trazer letras");
    assert.ok(
      secondFull!.crossword.progress.flat().every((cell) => cell === ""),
      "o difícil começou com letras no grid",
    );
    const firstIds = new Set(active.entries.map((entry) => entry.wordId));
    const reused = secondFull!.entries.filter((entry) => firstIds.has(entry.wordId)).length;
    const repeatedClues = secondFull!.entries.filter((entry) =>
      active.entries.some((old) => old.wordId === entry.wordId && old.clue === entry.clue),
    ).length;
    console.log(
      `✓ segundo crossword (difícil, grid vazio): ${secondFull!.entries.length} palavras, ` +
        `${reused} repetidas, ${repeatedClues} com a mesma dica de antes`,
    );

    await deleteCrossword(user.id, second.crossword.id);
    const leftovers = await db
      .select()
      .from(crosswordEntries)
      .where(eq(crosswordEntries.crosswordId, second.crossword.id));
    assert.equal(leftovers.length, 0, "entries órfãs após remoção");
    console.log("✓ remoção do crossword faz cascade nas entradas");

    const third = await generateCrosswordForUser(user.id, "medium");
    assert.equal(third.crossword.difficulty, "medium");
    assert.ok(third.crossword.givens.length > 0, "o médio deveria trazer algumas letras");
    console.log(`✓ novo crossword (médio) liberado após remoção, ${third.crossword.givens.length} letras dadas`);
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
