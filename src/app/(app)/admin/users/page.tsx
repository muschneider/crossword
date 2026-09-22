import { UserTable } from "@/components/admin/user-table";
import { isEmailEnabled } from "@/lib/env";
import { requireAdmin } from "@/lib/session";
import { listAllUsers } from "@/lib/user-repo";

export const metadata = { title: "Usuários" };

export default async function AdminUsersPage() {
  const admin = await requireAdmin();
  const rows = await listAllUsers();
  const pending = rows.filter((row) => row.status === "pending").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Usuários</h1>
          <p className="text-ink-300 mt-1 text-sm">
            Toda conta criada pelo cadastro entra como{" "}
            <span className="text-ink-100 font-semibold">pendente</span> e só acessa o app depois da
            aprovação.
          </p>
        </div>
        {pending > 0 && (
          <span className="badge bg-amber-500/15 px-3 py-1.5 text-amber-300">
            {pending} aguardando aprovação
          </span>
        )}
      </header>

      <UserTable rows={rows} currentUserId={admin.id} />

      <p className="text-ink-400 text-xs leading-relaxed">
        Recusar ou voltar para pendente encerra todas as sessões da pessoa na hora.
        {isEmailEnabled
          ? " Ao aprovar, enviamos um e-mail avisando."
          : " Configure o SMTP no .env para avisar por e-mail ao aprovar."}{" "}
        Para criar outro admin ou redefinir uma senha pelo terminal, use{" "}
        <code className="font-mono">mise run admin:create</code> e{" "}
        <code className="font-mono">mise run admin:password</code>.
      </p>
    </div>
  );
}
