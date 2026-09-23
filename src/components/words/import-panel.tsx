"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { importWordsAction } from "@/app/actions/words";
import { IDLE_STATE } from "@/lib/action-state";

const PLACEHOLDER = `- accomplish - realizar / alcançar / cumprir / concluir
- achieve - alcançar / atingir
- as far as I know - pelo que eu sei
- at least - pelo menos`;

export function ImportPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(importWordsAction, IDLE_STATE);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.ok) {
      if (textareaRef.current) textareaRef.current.value = "";
      router.refresh();
    }
  }, [state, router]);

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="hover:bg-sunken/60 flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-bold">Importar lista de palavras</span>
          <span className="text-ink-muted block text-xs">
            Cole quantas linhas quiser no formato <code className="font-mono">termo - tradução</code>
            . Duplicadas são descartadas automaticamente.
          </span>
        </span>
        <span className="text-ink-muted text-lg leading-none">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <form action={formAction} className="border-line space-y-3 border-t p-5">
          <div>
            <label htmlFor="content" className="label">
              Lista
            </label>
            <textarea
              ref={textareaRef}
              id="content"
              name="content"
              rows={10}
              spellCheck={false}
              placeholder={PLACEHOLDER}
              className="input font-mono text-xs leading-relaxed"
            />
            <p className="text-ink-muted mt-2 text-xs">
              Separadores aceitos: <code className="font-mono">-</code>{" "}
              <code className="font-mono">–</code> <code className="font-mono">=</code>{" "}
              <code className="font-mono">:</code>. Marcadores de lista (
              <code className="font-mono">-</code>, <code className="font-mono">*</code>,{" "}
              <code className="font-mono">1.</code>) são opcionais.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={isPending} className="btn-primary">
              {isPending ? "Importando…" : "Importar"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Fechar
            </button>
          </div>

          {state.message && (
            <div className={state.ok ? "notice-good" : "notice-bad"} role="status">
              <p className="font-semibold">{state.message}</p>
              {state.details && state.details.length > 0 && (
                <ul className="text-ink-soft mt-2 space-y-1 text-xs">
                  {state.details.map((detail, index) => (
                    <li key={index}>• {detail}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      )}
    </section>
  );
}
