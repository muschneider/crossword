import Link from "next/link";

import { GenerateButton } from "@/components/crossword/generate-panel";
import { CrosswordPlayer } from "@/components/crossword/player";
import { BulbIcon, GridIcon, TargetIcon, TrophyIcon } from "@/components/icons";
import { toClientCrossword } from "@/lib/crossword/client-types";
import { entryOutcome, getCurrentCrossword } from "@/lib/crossword/service";
import { isAiEnabled } from "@/lib/env";
import { requireApprovedUser } from "@/lib/session";
import { getVocabularyStats } from "@/lib/word-repo";
import { MAX_GRID_LENGTH, MIN_GRID_LENGTH } from "@/lib/words";

export const metadata = { title: "Crossword" };
/** Generation calls OpenRouter; give it room (Vercel Hobby allows up to 60s). */
export const maxDuration = 60;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}min ${String(seconds).padStart(2, "0")}s`;
}

/** `1 caiu`, `3 caíram`, `nenhuma caiu`. */
function counted(amount: number, singular: string, plural: string): string {
  if (amount === 0) return `nenhuma ${singular}`;
  return `${amount} ${amount === 1 ? singular : plural}`;
}

export default async function CrosswordPage() {
  const user = await requireApprovedUser();
  const [current, stats] = await Promise.all([
    getCurrentCrossword(user.id),
    getVocabularyStats(user.id),
  ]);

  const canGenerate = stats.usable >= 4;

  if (!current) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <div className="border-line-strong bg-surface text-ink mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border">
          <GridIcon size={30} />
        </div>
        <h1 className="headline text-3xl">Nenhum crossword ainda</h1>

        <p className="text-ink-soft mt-3 text-sm leading-relaxed">
          {canGenerate ? (
            <>
              <span className="text-ink font-semibold">{stats.due}</span> palavra(s) esperando
              revisão, de <span className="text-ink font-semibold">{stats.usable}</span>{" "}
              aproveitáveis no grid.
            </>
          ) : (
            <>
              São necessárias pelo menos 4 palavras com {MIN_GRID_LENGTH} a {MAX_GRID_LENGTH}{" "}
              letras. Você tem <span className="text-ink font-semibold">{stats.usable}</span>.
            </>
          )}
        </p>

        <div className="mt-7 flex flex-col items-center gap-3">
          {canGenerate ? (
            <GenerateButton />
          ) : (
            <Link href="/words" className="btn-primary">
              Cadastrar palavras
            </Link>
          )}
          {!isAiEnabled && (
            <p className="notice-warn text-xs">
              OpenRouter não configurado — sem a IA, as dicas ficam na tradução em português.
            </p>
          )}
        </div>

        <ul className="text-ink-soft mt-10 space-y-2.5 text-left text-xs">
          <li className="flex gap-2.5">
            <TargetIcon size={15} className="text-ink-muted mt-px shrink-0" />
            As palavras que você errou voltam antes; as dominadas espaçam até 35 dias.
          </li>
          <li className="flex gap-2.5">
            <BulbIcon size={15} className="text-ink-muted mt-px shrink-0" />
            As dicas são sempre em inglês e endurecem com o domínio: explicação simples, depois
            definição, depois dica curta de jornal. O botão PT mostra a tradução quando precisar.
          </li>
          <li className="flex gap-2.5">
            <TrophyIcon size={15} className="text-ink-muted mt-px shrink-0" />
            Resolver sem ajuda promove a palavra. Revelar metade dela rebaixa duas casas.
          </li>
        </ul>
      </div>
    );
  }

  const client = toClientCrossword(current.crossword, current.entries);
  const isCompleted = client.status === "completed";

  const outcomes = isCompleted
    ? current.entries.map((entry) => entryOutcome(entry, current.crossword.givens))
    : [];
  const promoted = outcomes.filter((outcome) => outcome === "clean").length;
  const demoted = outcomes.filter((outcome) => outcome === "failed").length;
  const assisted = outcomes.filter((outcome) => outcome === "assisted").length;
  const held = outcomes.filter((outcome) => outcome === "shaky").length + assisted;
  const free = outcomes.filter((outcome) => outcome === "skipped").length;

  return (
    <div className="space-y-5">
      {isCompleted && (
        <div className="card flex flex-wrap items-start justify-between gap-5 p-5 sm:p-6">
          <div className="max-w-xl">
            <h1 className="headline text-good flex items-center gap-2 text-2xl">
              <TrophyIcon size={22} />
              Crossword concluído
            </h1>
            <p className="text-ink-soft mt-2 text-sm leading-relaxed">
              {client.secondsPlayed > 0 && <>Resolvido em {formatClock(client.secondsPlayed)}. </>}
              <span className="text-good font-semibold">
                {counted(promoted, "subiu", "subiram")} de nível
              </span>
              {held > 0 && <> · {counted(held, "ficou", "ficaram")} no mesmo nível</>}
              {demoted > 0 && (
                <>
                  {" "}
                  · <span className="text-bad font-semibold">{counted(demoted, "caiu", "caíram")}</span>
                </>
              )}
              .
            </p>
            <p className="text-ink-muted mt-1.5 text-xs leading-relaxed">
              Sobe quem saiu sem ajuda. Letra revelada, erro na verificação ou tradução vista antes
              de acertar seguram a palavra no nível; revelar metade dela rebaixa.
              {assisted > 0 &&
                ` ${assisted === 1 ? "Uma palavra já veio" : `${assisted} palavras já vieram`} com metade das letras ou mais, então não ${assisted === 1 ? "subiu" : "subiram"} — mas também não conta como erro.`}
              {free > 0 && " A palavra que veio pronta não é pontuada."}
            </p>
          </div>
          <GenerateButton disabled={!canGenerate} label="Gerar outro" />
        </div>
      )}

      <CrosswordPlayer crossword={client} />
    </div>
  );
}
