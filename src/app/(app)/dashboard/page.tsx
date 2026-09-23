import Link from "next/link";

import { DifficultyBadge } from "@/components/crossword/difficulty-badge";
import { GenerateButton } from "@/components/crossword/generate-panel";
import { BookIcon, FlameIcon, TargetIcon, TrophyIcon } from "@/components/icons";
import { getActiveCrossword, listCrosswords } from "@/lib/crossword/service";
import { env, isAiEnabled } from "@/lib/env";
import { requireApprovedUser } from "@/lib/session";
import { getVocabularyStats, type VocabularyStats } from "@/lib/word-repo";
import { MAX_GRID_LENGTH, MIN_GRID_LENGTH } from "@/lib/words";

export const metadata = { title: "Início" };
export const maxDuration = 60;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function Stat({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`card p-5 ${accent ? "border-ink" : ""}`}>
      <p className="eyebrow flex items-center gap-1.5">
        <span className={accent ? "text-accent" : "text-ink-muted"}>{icon}</span>
        {label}
      </p>
      <p className="headline mt-1.5 text-4xl tabular-nums">{value}</p>
      {hint && <p className="text-ink-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}

/**
 * Distribution of the vocabulary across the Leitner ladder.
 *
 * This is the one chart that says whether studying is working: the mass should
 * drift left to right over time.
 */
function MasteryBar({ stats }: { stats: VocabularyStats }) {
  const bands = [
    { label: "novas", value: stats.neverUsed, className: "bg-line-strong" },
    { label: "em aprendizado", value: stats.struggling, className: "bg-cursor" },
    { label: "firmes", value: stats.learning, className: "bg-accent" },
    { label: "dominadas", value: stats.mastered, className: "bg-good" },
  ].filter((band) => band.value > 0);

  if (stats.total === 0) return null;

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="headline text-xl">Evolução do vocabulário</h2>
        <p className="text-ink-muted text-xs">
          A dica em inglês endurece conforme a palavra avança: explicação simples → definição →
          dica curta de jornal.
        </p>
      </div>

      <div className="bg-sunken mt-4 flex h-3 gap-px overflow-hidden rounded-full">
        {bands.map((band) => (
          <div
            key={band.label}
            className={band.className}
            style={{ width: `${(band.value / stats.total) * 100}%` }}
            title={`${band.label}: ${band.value}`}
          />
        ))}
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {bands.map((band) => (
          <div key={band.label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${band.className}`} />
            <dt className="text-ink-soft text-xs">{band.label}</dt>
            <dd className="text-ink text-xs font-semibold tabular-nums">{band.value}</dd>
          </div>
        ))}
      </dl>
    </section>
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
    <div className="space-y-6">
      <header>
        <h1 className="headline text-3xl sm:text-4xl">
          Olá, {user.name?.split(" ")[0] ?? "bem-vindo"}
        </h1>
        <p className="text-ink-soft mt-1.5 text-sm">
          {env.APP_NAME} monta palavras-cruzadas com o seu próprio vocabulário e devolve mais cedo
          o que você erra.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Para revisar"
          value={stats.due}
          hint={canGenerate ? "Entram primeiro no próximo crossword" : "Cadastre mais palavras"}
          icon={<TargetIcon size={14} />}
          accent={stats.due > 0}
        />
        <Stat
          label="Dominadas"
          value={stats.mastered}
          hint={`de ${stats.total} palavras`}
          icon={<TrophyIcon size={14} />}
        />
        <Stat
          label="Melhor sequência"
          value={stats.bestStreak}
          hint="Acertos seguidos numa mesma palavra"
          icon={<FlameIcon size={14} />}
        />
        <Stat
          label="Concluídos"
          value={completed}
          hint={`${history.length} no histórico`}
          icon={<BookIcon size={14} />}
        />
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-xl">
            <h2 className="headline text-2xl">
              {active ? "Você tem um crossword em andamento" : "Gerar novo crossword"}
            </h2>
            <p className="text-ink-soft mt-1.5 text-sm leading-relaxed">
              {active ? (
                <>
                  Só é possível ter <span className="text-ink font-semibold">um</span> crossword por
                  vez. Finalize ou remova <span className="text-ink">{active.crossword.title}</span>{" "}
                  para gerar outro.
                </>
              ) : canGenerate ? (
                <>
                  Cada crossword prioriza o que está vencido na sua agenda de revisão. A dificuldade
                  decide quantas letras já começam no grid; as dicas, em inglês, são escritas e
                  conferidas pela IA antes de chegar até você.
                </>
              ) : (
                <>
                  Cadastre pelo menos 4 palavras com {MIN_GRID_LENGTH}–{MAX_GRID_LENGTH} letras
                  para liberar a geração. Você tem{" "}
                  <span className="text-ink font-semibold">{stats.usable}</span>.
                </>
              )}
            </p>
            {!active && canGenerate && !isAiEnabled && (
              <p className="notice-warn mt-3 text-xs">
                OpenRouter não configurado — sem a IA, as dicas ficam na tradução em português.
              </p>
            )}
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
            <Link href="/words" className="btn-ghost justify-start px-0 sm:px-4">
              Gerenciar palavras
            </Link>
          </div>
        </div>
      </section>

      <MasteryBar stats={stats} />

      {history.length > 0 && (
        <section>
          <h2 className="eyebrow mb-3">Histórico</h2>
          <div className="card divide-line divide-y">
            {history.map((crossword) => (
              <div
                key={crossword.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {crossword.title}
                    <DifficultyBadge difficulty={crossword.difficulty} />
                  </p>
                  <p className="text-ink-muted mt-0.5 text-xs">
                    {crossword.width}×{crossword.height} ·{" "}
                    {dateFormatter.format(crossword.createdAt)}
                    {crossword.secondsPlayed > 0 && ` · ${formatClock(crossword.secondsPlayed)}`}
                  </p>
                </div>
                <span
                  className={`badge ${
                    crossword.status === "completed"
                      ? "bg-good-soft text-good"
                      : "bg-accent-soft text-accent-strong"
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
