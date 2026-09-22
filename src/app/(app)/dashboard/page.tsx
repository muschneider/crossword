import Link from "next/link";

import { GenerateButton } from "@/components/crossword/generate-panel";
import { getActiveCrossword, listCrosswords } from "@/lib/crossword/service";
import { env, isAiEnabled } from "@/lib/env";
import { requireApprovedUser } from "@/lib/session";
import { getVocabularyStats } from "@/lib/word-repo";

export const metadata = { title: "Início" };
export const maxDuration = 60;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-ink-400 text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p className="mt-1.5 text-3xl font-black tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-ink-400 mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireApprovedUser();
  const [stats, active, history] = await Promise.all([
    getVocabularyStats(user.id),
    getActiveCrossword(user.id),
    listCrosswords(user.id, 8),
  ]);

  const canGenerate = stats.usable >= 4;
  const completed = history.filter((crossword) => crossword.status === "completed").length;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-black tracking-tight">
          Olá, {user.name?.split(" ")[0] ?? "bem-vindo"} 👋
        </h1>
        <p className="text-ink-300 mt-1 text-sm">
          {env.APP_NAME} monta palavras-cruzadas com o seu próprio vocabulário.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Palavras"
          value={stats.total}
          hint={`${stats.usable} aproveitáveis no grid`}
        />
        <Stat
          label="Nunca usadas"
          value={stats.neverUsed}
          hint="Entram primeiro no rodízio"
        />
        <Stat label="Usos acumulados" value={stats.totalUses} hint="Somando todos os crosswords" />
        <Stat label="Concluídos" value={completed} hint={`${history.length} no histórico`} />
      </section>

      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-xl">
            <h2 className="text-lg font-bold tracking-tight">
              {active ? "Você tem um crossword em andamento" : "Gerar novo crossword"}
            </h2>
            <p className="text-ink-300 mt-1.5 text-sm leading-relaxed">
              {active ? (
                <>
                  Só é possível ter <span className="text-ink-100 font-semibold">um</span> crossword
                  por vez. Finalize ou remova <span className="text-ink-100">{active.crossword.title}</span>{" "}
                  para gerar outro.
                </>
              ) : canGenerate ? (
                <>
                  Cada crossword usa um subconjunto aleatório do seu vocabulário, priorizando as
                  palavras menos usadas. Parte das dicas vem da tradução em português e parte é
                  gerada {isAiEnabled ? "por IA" : "por IA (desativada — configure OPENROUTER_API_KEY)"}.
                </>
              ) : (
                <>
                  Cadastre pelo menos 4 palavras com {3}–{15} letras para liberar a geração. Você tem{" "}
                  <span className="text-ink-100 font-semibold">{stats.usable}</span>.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {active ? (
              <Link href="/crossword" className="btn-primary">
                Continuar jogando
              </Link>
            ) : canGenerate ? (
              <GenerateButton />
            ) : (
              <Link href="/words" className="btn-primary">
                Cadastrar palavras
              </Link>
            )}
            <Link href="/words" className="btn-ghost">
              Gerenciar palavras
            </Link>
          </div>
        </div>
      </section>

      {history.length > 0 && (
        <section>
          <h2 className="text-ink-300 mb-3 text-xs font-bold tracking-wider uppercase">
            Histórico
          </h2>
          <div className="card divide-ink-800 divide-y">
            {history.map((crossword) => (
              <div
                key={crossword.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div>
                  <p className="text-sm font-semibold">{crossword.title}</p>
                  <p className="text-ink-400 text-xs">
                    {crossword.width}×{crossword.height} · criado em{" "}
                    {dateFormatter.format(crossword.createdAt)}
                  </p>
                </div>
                <span
                  className={`badge ${
                    crossword.status === "completed"
                      ? "bg-brand-500/15 text-brand-400"
                      : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  {crossword.status === "completed" ? "concluído" : "em andamento"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
