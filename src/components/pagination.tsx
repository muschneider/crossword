import Link from "next/link";

export function Pagination({
  page,
  pageCount,
  total,
  buildHref,
}: {
  page: number;
  pageCount: number;
  total: number;
  buildHref: (page: number) => string;
}) {
  if (pageCount <= 1) {
    return (
      <p className="text-ink-400 text-xs">
        {total} palavra{total === 1 ? "" : "s"}
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-ink-400 text-xs">
        Página {page} de {pageCount} · {total} palavras
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={buildHref(page - 1)} className="btn-secondary">
            Anterior
          </Link>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-40">Anterior</span>
        )}
        {page < pageCount ? (
          <Link href={buildHref(page + 1)} className="btn-secondary">
            Próxima
          </Link>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-40">Próxima</span>
        )}
      </div>
    </div>
  );
}
