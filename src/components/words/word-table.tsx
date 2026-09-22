"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createWordAction,
  deleteWordAction,
  deleteWordsAction,
  updateWordAction,
} from "@/app/actions/words";
import { IDLE_STATE, type ActionState } from "@/lib/action-state";
import { PencilIcon, TrashIcon } from "@/components/icons";
import type { Word } from "@/db/schema";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

function Feedback({ state }: { state: ActionState | null }) {
  if (!state?.message) return null;
  return (
    <p
      role="status"
      className={`rounded-xl border px-4 py-2.5 text-sm ${
        state.ok
          ? "border-brand-500/30 bg-brand-500/10 text-brand-400"
          : "border-red-500/30 bg-red-500/10 text-red-300"
      }`}
    >
      {state.message}
    </p>
  );
}

export function WordTable({ items, usableRange }: { items: Word[]; usableRange: [number, number] }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  // Rows can disappear after a refresh; drop stale selections.
  useEffect(() => {
    setSelected((previous) => {
      const alive = new Set(items.map((item) => item.id));
      const next = new Set([...previous].filter((id) => alive.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [items]);

  const run = (action: (prev: ActionState, data: FormData) => Promise<ActionState>, data: FormData) =>
    startTransition(async () => {
      const result = await action(IDLE_STATE, data);
      setState(result);
      if (result.ok) {
        setEditingId(null);
        setAdding(false);
        router.refresh();
      }
    });

  const onSubmitEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(updateWordAction, new FormData(event.currentTarget));
  };

  const onSubmitCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await createWordAction(IDLE_STATE, data);
      setState(result);
      if (result.ok) {
        form.reset();
        router.refresh();
      }
    });
  };

  const onDelete = (word: Word) => {
    if (!window.confirm(`Remover "${word.term}"?`)) return;
    const data = new FormData();
    data.set("id", word.id);
    run(deleteWordAction, data);
  };

  const onDeleteSelected = () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Remover ${selected.size} palavra(s) selecionada(s)?`)) return;
    const data = new FormData();
    for (const id of selected) data.append("ids", id);
    startTransition(async () => {
      const result = await deleteWordsAction(IDLE_STATE, data);
      setState(result);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  };

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAdding((previous) => !previous)}
            className="btn-secondary"
          >
            {adding ? "Cancelar" : "+ Nova palavra"}
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={onDeleteSelected}
              disabled={isPending}
              className="btn-danger"
            >
              <TrashIcon />
              Remover {selected.size}
            </button>
          )}
        </div>
      </div>

      {adding && (
        <form onSubmit={onSubmitCreate} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="label" htmlFor="new-term">
              Termo (inglês)
            </label>
            <input id="new-term" name="term" required className="input" placeholder="give up" />
          </div>
          <div>
            <label className="label" htmlFor="new-translation">
              Tradução (português)
            </label>
            <input
              id="new-translation"
              name="translation"
              required
              className="input"
              placeholder="desistir / render-se"
            />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={isPending} className="btn-primary w-full sm:w-auto">
              Adicionar
            </button>
          </div>
        </form>
      )}

      <Feedback state={state} />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-ink-700/70 text-ink-400 border-b text-left text-xs tracking-wide uppercase">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
                    }
                    className="accent-brand-500 h-4 w-4 cursor-pointer"
                  />
                </th>
                <th className="px-2 py-3 font-semibold">Termo</th>
                <th className="px-2 py-3 font-semibold">Tradução</th>
                <th className="w-24 px-2 py-3 text-center font-semibold">Usos</th>
                <th className="w-28 px-2 py-3 font-semibold">Último uso</th>
                <th className="w-24 px-4 py-3 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-ink-400 px-4 py-10 text-center text-sm">
                    Nenhuma palavra encontrada.
                  </td>
                </tr>
              )}

              {items.map((word) => {
                const editing = editingId === word.id;
                const length = word.answer.length;
                const unusable = length < usableRange[0] || length > usableRange[1];

                if (editing) {
                  return (
                    <tr key={word.id} className="border-ink-800 bg-ink-800/40 border-b">
                      <td colSpan={6} className="px-4 py-3">
                        <form
                          onSubmit={onSubmitEdit}
                          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                        >
                          <input type="hidden" name="id" value={word.id} />
                          <div>
                            <label className="label">Termo</label>
                            <input
                              name="term"
                              defaultValue={word.term}
                              required
                              autoFocus
                              className="input"
                            />
                          </div>
                          <div>
                            <label className="label">Tradução</label>
                            <input
                              name="translation"
                              defaultValue={word.translation}
                              required
                              className="input"
                            />
                          </div>
                          <div className="flex items-end gap-2">
                            <button type="submit" disabled={isPending} className="btn-primary">
                              Salvar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="btn-ghost"
                            >
                              Cancelar
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={word.id}
                    className="border-ink-800 hover:bg-ink-800/40 border-b transition-colors last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${word.term}`}
                        checked={selected.has(word.id)}
                        onChange={() => toggle(word.id)}
                        className="accent-brand-500 h-4 w-4 cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="text-ink-100 font-semibold">{word.term}</span>
                      {unusable && (
                        <span
                          className="badge ml-2 bg-amber-500/15 text-amber-300"
                          title={`Só entram no grid termos com ${usableRange[0]} a ${usableRange[1]} letras (este tem ${length}).`}
                        >
                          fora do grid
                        </span>
                      )}
                    </td>
                    <td className="text-ink-300 px-2 py-2.5">{word.translation}</td>
                    <td className="px-2 py-2.5 text-center">
                      <span
                        className={`badge ${
                          word.usageCount === 0
                            ? "bg-ink-700 text-ink-300"
                            : "bg-brand-500/15 text-brand-400"
                        }`}
                      >
                        {word.usageCount}
                      </span>
                    </td>
                    <td className="text-ink-400 px-2 py-2.5 text-xs">
                      {word.lastUsedAt ? dateFormatter.format(word.lastUsedAt) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingId(word.id)}
                          className="btn-ghost p-2"
                          title="Editar"
                        >
                          <PencilIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(word)}
                          disabled={isPending}
                          className="btn-ghost p-2 hover:bg-red-500/15 hover:text-red-300"
                          title="Remover"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
