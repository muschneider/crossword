import Link from "next/link";

import { GenerateButton } from "@/components/crossword/generate-panel";
import { CrosswordPlayer } from "@/components/crossword/player";
import { toClientCrossword } from "@/lib/crossword/client-types";
import { getCurrentCrossword } from "@/lib/crossword/service";
import { isAiEnabled } from "@/lib/env";
import { requireApprovedUser } from "@/lib/session";
import { getVocabularyStats } from "@/lib/word-repo";

export const metadata = { title: "Crossword" };
/** Generation calls OpenRouter; give it room (Vercel Hobby allows up to 60s). */
export const maxDuration = 60;

export default async function CrosswordPage() {
  const user = await requireApprovedUser();
  const [current, stats] = await Promise.all([
    getCurrentCrossword(user.id),
    getVocabularyStats(user.id),
  ]);

  const canGenerate = stats.usable >= 4;

  if (!current) {
    return (
      <div className="mx-auto max-w-xl py-10 text-center">
        <div className="border-brand-500/25 bg-brand-500/10 text-brand-400 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border text-3xl">
          ✶
        </div>
        <h1 className="text-2xl font-black tracking-tight">Nenhum crossword ainda</h1>
        <p className="text-ink-300 mt-3 text-sm leading-relaxed">
          {canGenerate ? (
            <>
              Você tem <span className="text-ink-100 font-semibold">{stats.usable}</span> palavras
              prontas para virar um crossword. As menos usadas têm prioridade.
            </>
          ) : (
            <>
              São necessárias pelo menos 4 palavras com 3 a 15 letras. Você tem{" "}
              <span className="text-ink-100 font-semibold">{stats.usable}</span>.
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
            <p className="text-ink-400 text-xs">
              OpenRouter não configurado — todas as dicas usarão a tradução em português.
            </p>
          )}
        </div>
      </div>
    );
  }

  const client = toClientCrossword(current.crossword, current.entries);
  const isCompleted = client.status === "completed";

  return (
    <div className="space-y-6">
      {isCompleted && (
        <div className="card border-brand-500/25 bg-brand-500/5 flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h1 className="text-brand-400 text-lg font-bold tracking-tight">
              Crossword concluído 🎉
            </h1>
            <p className="text-ink-300 mt-1 text-sm">
              As respostas estão reveladas abaixo. Gere um novo quando quiser — as palavras menos
              usadas entram primeiro.
            </p>
          </div>
          <GenerateButton disabled={!canGenerate} />
        </div>
      )}

      <CrosswordPlayer crossword={client} />
    </div>
  );
}
