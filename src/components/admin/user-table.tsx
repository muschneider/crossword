"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteUserAction, setUserRoleAction, setUserStatusAction } from "@/app/actions/admin";
import type { ActionState } from "@/lib/action-state";
import { TrashIcon } from "@/components/icons";
import type { UserRole, UserStatus } from "@/db/schema";
import type { AdminUserRow } from "@/lib/user-repo";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

const STATUS_STYLE: Record<UserStatus, string> = {
  pending: "bg-warn-soft text-warn",
  approved: "bg-good-soft text-good",
  rejected: "bg-bad-soft text-bad",
};

const STATUS_LABEL: Record<UserStatus, string> = {
  pending: "pendente",
  approved: "aprovado",
  rejected: "recusado",
};

export function UserTable({ rows, currentUserId }: { rows: AdminUserRow[]; currentUserId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (operation: () => Promise<ActionState>) =>
    startTransition(async () => {
      const result = await operation();
      setState(result);
      if (result.ok) router.refresh();
    });

  const onStatus = (id: string, status: UserStatus) => run(() => setUserStatusAction(id, status));
  const onRole = (id: string, role: UserRole) => run(() => setUserRoleAction(id, role));
  const onDelete = (row: AdminUserRow) => {
    const warning =
      `Excluir ${row.email}?\n\n` +
      `Isso remove ${row.wordCount} palavra(s) e ${row.crosswordCount} crossword(s) desse usuário.`;
    if (!window.confirm(warning)) return;
    run(() => deleteUserAction(row.id));
  };

  return (
    <div className="space-y-4">
      {state?.message && (
        <p role="status" className={state.ok ? "notice-good" : "notice-bad"}>
          {state.message}
        </p>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-line text-ink-muted bg-paper/60 border-b text-left text-xs tracking-wide uppercase">
                <th className="px-5 py-3 font-semibold">Usuário</th>
                <th className="w-28 px-2 py-3 font-semibold">Situação</th>
                <th className="w-24 px-2 py-3 font-semibold">Papel</th>
                <th className="w-32 px-2 py-3 text-center font-semibold">Conteúdo</th>
                <th className="w-32 px-2 py-3 font-semibold">Cadastro</th>
                <th className="w-72 px-5 py-3 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelf = row.id === currentUserId;

                return (
                  <tr
                    key={row.id}
                    className="border-line hover:bg-sunken/50 border-b transition-colors last:border-0"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="border-line-strong bg-paper text-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold">
                          {row.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">
                            {row.name}
                            {isSelf && <span className="text-ink-muted ml-2 text-xs">(você)</span>}
                          </p>
                          <p className="text-ink-muted truncate text-xs">{row.email}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-2 py-3">
                      <span className={`badge ${STATUS_STYLE[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>

                    <td className="px-2 py-3">
                      <span
                        className={`badge ${
                          row.role === "admin" ? "bg-accent-soft text-accent-strong" : "bg-sunken text-ink-soft"
                        }`}
                      >
                        {row.role}
                      </span>
                    </td>

                    <td className="text-ink-muted px-2 py-3 text-center text-xs">
                      {row.wordCount} palavras
                      <br />
                      {row.crosswordCount} crosswords
                    </td>

                    <td className="text-ink-muted px-2 py-3 text-xs">
                      {dateFormatter.format(row.createdAt)}
                      <br />
                      <span className="text-ink-faint">
                        {row.lastLoginAt
                          ? `último acesso ${dateFormatter.format(row.lastLoginAt)}`
                          : "nunca acessou"}
                      </span>
                    </td>

                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {row.status !== "approved" && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => onStatus(row.id, "approved")}
                            className="btn-primary px-3 py-1.5 text-xs"
                          >
                            Aprovar
                          </button>
                        )}
                        {row.status !== "rejected" && !isSelf && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => onStatus(row.id, "rejected")}
                            className="btn-secondary px-3 py-1.5 text-xs"
                          >
                            Recusar
                          </button>
                        )}
                        {!isSelf && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => onRole(row.id, row.role === "admin" ? "user" : "admin")}
                            className="btn-ghost px-3 py-1.5 text-xs"
                          >
                            {row.role === "admin" ? "Rebaixar" : "Tornar admin"}
                          </button>
                        )}
                        {!isSelf && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => onDelete(row)}
                            className="btn-ghost hover:bg-bad-soft hover:text-bad p-2"
                            title="Excluir usuário e todo o conteúdo"
                          >
                            <TrashIcon />
                          </button>
                        )}
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
