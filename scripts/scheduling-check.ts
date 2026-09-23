/**
 * Exercises the spaced-repetition rules and the rotation weighting.
 *
 * Pure functions, no database and no network.
 *   mise run test:scheduling
 */
import "dotenv/config";

import assert from "node:assert/strict";

import type { Word } from "../src/db/schema";
import { createRng } from "../src/lib/crossword/random";
import {
  applyOutcome,
  classifyOutcome,
  clueTierFor,
  dueDateFor,
  MAX_LEVEL,
  REVIEW_INTERVAL_DAYS,
  rotationWeight,
  type ScheduleInput,
} from "../src/lib/crossword/scheduling";
import { selectWords } from "../src/lib/crossword/selector";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 15);

let checks = 0;
function check(label: string, run: () => void) {
  run();
  checks += 1;
  console.log(`  ✓ ${label}`);
}

const fresh = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  level: 0,
  streak: 0,
  bestStreak: 0,
  correctCount: 0,
  missCount: 0,
  ...over,
});

/* ------------------------------------------------------------------ */
console.log("\nclassificação do resultado");

const outcome = (
  length: number,
  revealedCount: number,
  wrongChecks = 0,
  extra: { givenCount?: number; usedTranslation?: boolean } = {},
) => classifyOutcome({ length, revealedCount, wrongChecks, ...extra });

check("sem ajuda e sem erro → clean", () => {
  assert.equal(outcome(7, 0), "clean");
});

check("uma letra revelada numa palavra longa → shaky, não failed", () => {
  assert.equal(outcome(7, 1), "shaky");
  assert.equal(outcome(7, 3), "shaky");
});

check("erro de digitação sem revelar → shaky", () => {
  assert.equal(outcome(7, 0, 2), "shaky");
});

check("metade da palavra revelada → failed", () => {
  assert.equal(outcome(7, 4), "failed");
  assert.equal(outcome(7, 7), "failed");
});

check("palavra curta precisa de 2 letras para virar failed", () => {
  assert.equal(outcome(3, 1), "shaky");
  assert.equal(outcome(3, 2), "failed");
});

check("ver a tradução antes de acertar → shaky", () => {
  assert.equal(outcome(7, 0, 0, { usedTranslation: true }), "shaky");
  assert.equal(outcome(7, 4, 0, { usedTranslation: true }), "failed", "revelar metade ainda pesa mais");
});

check("letras dadas pela dificuldade não são dica, mas metade dada não promove", () => {
  assert.equal(outcome(8, 0, 0, { givenCount: 3 }), "clean");
  assert.equal(outcome(8, 0, 0, { givenCount: 4 }), "assisted");
  assert.equal(outcome(8, 0, 1, { givenCount: 4 }), "shaky", "erro continua contando");
});

check("a palavra inteira dada (a grátis do fácil) não é pontuada", () => {
  assert.equal(outcome(6, 0, 0, { givenCount: 6 }), "skipped");
});

check("com letras dadas, 'metade revelada' conta sobre o que faltava achar", () => {
  // 10 letras, 4 dadas: faltavam 6, então 3 reveladas já é metade.
  assert.equal(outcome(10, 3, 0, { givenCount: 4 }), "failed");
  assert.equal(outcome(10, 2, 0, { givenCount: 4 }), "shaky");
});

/* ------------------------------------------------------------------ */
console.log("\nprogressão entre caixas");

check("acerto limpo sobe uma caixa e soma streak", () => {
  const next = applyOutcome(fresh({ level: 2, streak: 3, bestStreak: 3 }), "clean", NOW);
  assert.equal(next.level, 3);
  assert.equal(next.streak, 4);
  assert.equal(next.bestStreak, 4);
  assert.equal(next.correctCount, 1);
  assert.equal(next.missCount, 0);
});

check("shaky mantém a caixa e zera o streak", () => {
  const next = applyOutcome(fresh({ level: 3, streak: 5, bestStreak: 5 }), "shaky", NOW);
  assert.equal(next.level, 3);
  assert.equal(next.streak, 0);
  assert.equal(next.bestStreak, 5, "o recorde não pode ser perdido");
  assert.equal(next.missCount, 1);
});

check("failed cai duas caixas", () => {
  assert.equal(applyOutcome(fresh({ level: 4 }), "failed", NOW).level, 2);
  assert.equal(applyOutcome(fresh({ level: 1 }), "failed", NOW).level, 0, "não passa de 0");
});

check("assisted mantém a caixa e a sequência, sem contar erro", () => {
  const next = applyOutcome(fresh({ level: 2, streak: 3, bestStreak: 4 }), "assisted", NOW);
  assert.equal(next.level, 2);
  assert.equal(next.streak, 3);
  assert.equal(next.bestStreak, 4);
  assert.equal(next.missCount, 0);
  assert.equal(next.correctCount, 0);
});

check("nível satura no topo", () => {
  const next = applyOutcome(fresh({ level: MAX_LEVEL, streak: 9 }), "clean", NOW);
  assert.equal(next.level, MAX_LEVEL);
});

check("o intervalo cresce a cada caixa", () => {
  for (let level = 1; level < REVIEW_INTERVAL_DAYS.length; level += 1) {
    assert.ok(
      REVIEW_INTERVAL_DAYS[level] > REVIEW_INTERVAL_DAYS[level - 1],
      `intervalo não cresce no nível ${level}`,
    );
  }
  assert.equal(dueDateFor(0, NOW).getTime(), NOW, "nível 0 volta imediatamente");
  assert.equal(dueDateFor(5, NOW).getTime(), NOW + 35 * DAY);
});

check("uma palavra errada volta bem antes de uma acertada", () => {
  const failed = applyOutcome(fresh({ level: 3 }), "failed", NOW);
  const clean = applyOutcome(fresh({ level: 3 }), "clean", NOW);
  assert.ok(
    failed.dueAt.getTime() < clean.dueAt.getTime(),
    "a palavra errada deveria voltar antes",
  );
});

/* ------------------------------------------------------------------ */
console.log("\ndificuldade da dica acompanha o domínio");

check("níveis 0-1 explicação simples, 2-3 definição, 4-5 dica de jornal — tudo em inglês", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(clueTierFor),
    ["simple", "simple", "definition", "definition", "crossword", "crossword"],
  );
});

check("a escada de dificuldade é monótona ao subir de caixa", () => {
  const rank = { simple: 0, definition: 1, crossword: 2 };
  let previous = -1;
  for (let level = 0; level <= MAX_LEVEL; level += 1) {
    const current = rank[clueTierFor(level)];
    assert.ok(current >= previous, `dica ficou mais fácil no nível ${level}`);
    previous = current;
  }
});

/* ------------------------------------------------------------------ */
console.log("\npeso do rodízio");

const used = (over: Partial<Parameters<typeof rotationWeight>[0]>) =>
  rotationWeight(
    { level: 0, dueAt: new Date(NOW), lastUsedAt: new Date(NOW - DAY), usageCount: 1, ...over },
    NOW,
  );

check("palavra nunca usada tem a maior prioridade", () => {
  const never = rotationWeight(
    { level: 0, dueAt: null, lastUsedAt: null, usageCount: 0 },
    NOW,
  );
  assert.ok(never > used({}), "palavra nova deveria vir antes de uma vencida");
});

check("palavra vencida pesa muito mais que uma ainda no prazo", () => {
  const due = used({ dueAt: new Date(NOW - 5 * DAY) });
  const notDue = used({ dueAt: new Date(NOW + 5 * DAY) });
  assert.ok(due > notDue * 20, `esperado ≥20x, obtido ${(due / notDue).toFixed(1)}x`);
});

check("quanto mais atrasada, maior o peso — até saturar", () => {
  const a = used({ dueAt: new Date(NOW - DAY) });
  const b = used({ dueAt: new Date(NOW - 4 * DAY) });
  const c = used({ dueAt: new Date(NOW - 60 * DAY) });
  assert.ok(b > a, "4 dias de atraso deveria pesar mais que 1");
  assert.ok(c >= b, "o peso não pode cair com mais atraso");
  assert.ok(c < b * 3, "o peso precisa saturar, não explodir");
});

check("palavra fraca pesa mais que palavra dominada, no mesmo atraso", () => {
  const weak = used({ level: 0, dueAt: new Date(NOW - DAY) });
  const strong = used({ level: 5, dueAt: new Date(NOW - DAY) });
  assert.ok(weak > strong * 5, `esperado ≥5x, obtido ${(weak / strong).toFixed(1)}x`);
});

check("linhas antigas sem due_at são tratadas como vencidas", () => {
  const legacy = used({ dueAt: null, lastUsedAt: new Date(NOW - 10 * DAY) });
  const scheduled = used({ dueAt: new Date(NOW + 10 * DAY) });
  assert.ok(legacy > scheduled, "palavra sem agenda deveria estar disponível");
});

/* ------------------------------------------------------------------ */
console.log("\nsimulação: 70 crosswords sobre 120 palavras (caminho real)");

{
  const SIZE = 120;
  const PUZZLES = 70;
  const TARGET = 12;

  const vocabulary: Word[] = Array.from({ length: SIZE }, (_, index) => {
    const term = `word${String(index).padStart(3, "0")}`;
    return {
      id: String(index),
      userId: "sim",
      term,
      normalized: term,
      // Lengths 4..11, so the grid constraints stay realistic.
      answer: term.toUpperCase().slice(0, 4 + (index % 8)),
      translation: `tradução ${index}`,
      usageCount: 0,
      lastUsedAt: null,
      level: 0,
      dueAt: null,
      streak: 0,
      bestStreak: 0,
      correctCount: 0,
      missCount: 0,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    };
  });

  // A learner who reliably misses a quarter of their list.
  const hard = new Set(vocabulary.filter((_, index) => index % 4 === 0).map((word) => word.id));

  const seen = new Map<string, number>();
  const rng = createRng(20260115);
  let clock = NOW;

  for (let puzzle = 0; puzzle < PUZZLES; puzzle += 1) {
    const { chosen } = selectWords(vocabulary, {
      targetWords: TARGET,
      poolSize: 40,
      rng,
      now: clock,
    });

    for (const picked of chosen) {
      const word = vocabulary.find((candidate) => candidate.id === picked.id)!;
      seen.set(word.id, (seen.get(word.id) ?? 0) + 1);
      Object.assign(word, applyOutcome(word, hard.has(word.id) ? "failed" : "clean", clock));
      word.lastUsedAt = new Date(clock);
      word.usageCount += 1;
    }

    clock += DAY;
  }

  const hardWords = vocabulary.filter((word) => hard.has(word.id));
  const easyWords = vocabulary.filter((word) => !hard.has(word.id));
  const avg = (list: Word[]) =>
    list.reduce((sum, word) => sum + (seen.get(word.id) ?? 0), 0) / list.length;
  const mastered = easyWords.filter((word) => word.level >= 4).length;

  console.log(
    `  ${seen.size}/${SIZE} palavras usadas · difíceis ${avg(hardWords).toFixed(1)}x · ` +
      `fáceis ${avg(easyWords).toFixed(1)}x · ${mastered}/${easyWords.length} dominadas`,
  );

  check("o vocabulário inteiro é coberto", () => {
    assert.equal(seen.size, SIZE, `só ${seen.size} palavras apareceram`);
  });

  check("as palavras erradas aparecem bem mais que as sabidas", () => {
    assert.ok(
      avg(hardWords) > avg(easyWords) * 1.5,
      `difíceis ${avg(hardWords).toFixed(1)}x vs fáceis ${avg(easyWords).toFixed(1)}x`,
    );
  });

  check("mas não monopolizam o crossword", () => {
    const share = (avg(hardWords) * hardWords.length) / (PUZZLES * TARGET);
    assert.ok(share < 0.6, `palavras difíceis ocuparam ${Math.round(share * 100)}% das vagas`);
  });

  check("as palavras sabidas chegam ao topo da escada", () => {
    assert.ok(
      mastered >= easyWords.length * 0.9,
      `só ${mastered}/${easyWords.length} dominadas`,
    );
  });

  check("as palavras erradas continuam na base da escada", () => {
    assert.ok(
      hardWords.every((word) => word.level <= 1),
      "uma palavra sempre errada não pode ser considerada dominada",
    );
  });

  check("as dicas acompanham: as sabidas endurecem, as erradas continuam simples", () => {
    const harderForEasy = easyWords.filter((word) => clueTierFor(word.level) !== "simple");
    assert.ok(
      harderForEasy.length > easyWords.length * 0.8,
      `só ${harderForEasy.length}/${easyWords.length} passariam da explicação simples`,
    );
    assert.ok(
      hardWords.every((word) => clueTierFor(word.level) === "simple"),
      "palavra sempre errada não pode receber a dica mais difícil",
    );
  });
}

/* ------------------------------------------------------------------ */
console.log(`\n✓ ${checks} verificações passaram\n`);
