import { Suspense } from "react";

import { Pagination } from "@/components/pagination";
import { ImportPanel } from "@/components/words/import-panel";
import { WordTable } from "@/components/words/word-table";
import { WordsToolbar } from "@/components/words/words-toolbar";
import { requireApprovedUser } from "@/lib/session";
import { listWords, type WordSort } from "@/lib/word-repo";
import { MAX_GRID_LENGTH, MIN_GRID_LENGTH } from "@/lib/words";

export const metadata = { title: "Palavras" };

const SORTS: WordSort[] = ["recent", "alpha", "least-used", "most-used"];

export default async function WordsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; page?: string }>;
}) {
  const user = await requireApprovedUser();
  const params = await searchParams;

  const sort = (SORTS.includes(params.sort as WordSort) ? params.sort : "recent") as WordSort;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const search = params.q?.trim() ?? "";

  const result = await listWords({ userId: user.id, search, sort, page, pageSize: 25 });

  const buildHref = (nextPage: number) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (sort !== "recent") query.set("sort", sort);
    if (nextPage > 1) query.set("page", String(nextPage));
    const queryString = query.toString();
    return queryString ? `/words?${queryString}` : "/words";
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black tracking-tight">Suas palavras</h1>
        <p className="text-ink-300 mt-1 text-sm">
          Vocabulário pessoal usado para gerar os crosswords. Nada é compartilhado entre usuários.
        </p>
      </header>

      <ImportPanel />

      <Suspense fallback={<div className="h-11" />}>
        <WordsToolbar />
      </Suspense>

      <WordTable items={result.items} usableRange={[MIN_GRID_LENGTH, MAX_GRID_LENGTH]} />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        buildHref={buildHref}
      />
    </div>
  );
}
