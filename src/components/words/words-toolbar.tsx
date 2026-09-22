"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { resetUsageAction } from "@/app/actions/words";

const SORTS = [
  { value: "recent", label: "Mais recentes" },
  { value: "alpha", label: "Ordem alfabética" },
  { value: "least-used", label: "Menos usadas" },
  { value: "most-used", label: "Mais usadas" },
];

export function WordsToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [search, setSearch] = useState(params.get("q") ?? "");
  const [isPending, startTransition] = useTransition();

  const push = (next: URLSearchParams) => {
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  // Debounced search so typing doesn't hammer the database.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (search === current) return;

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (search) next.set("q", search);
      else next.delete("q");
      next.delete("page");
      push(next);
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, params]);

  const onSort = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === "recent") next.delete("sort");
    else next.set("sort", value);
    next.delete("page");
    push(next);
  };

  const onResetUsage = () => {
    if (!window.confirm("Zerar os contadores de uso de todas as suas palavras?")) return;
    startTransition(async () => {
      await resetUsageAction();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-[14rem] flex-1">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por termo ou tradução…"
          aria-label="Buscar palavras"
          className="input"
        />
      </div>

      <select
        value={params.get("sort") ?? "recent"}
        onChange={(event) => onSort(event.target.value)}
        aria-label="Ordenar"
        className="input w-auto cursor-pointer"
      >
        {SORTS.map((sort) => (
          <option key={sort.value} value={sort.value}>
            {sort.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={onResetUsage}
        disabled={isPending}
        className="btn-ghost"
        title="Coloca todas as palavras de volta no rodízio"
      >
        Zerar usos
      </button>
    </div>
  );
}
