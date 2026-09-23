import { redirect } from "next/navigation";

import { signOutAction } from "@/app/actions/auth";
import { PendingWatcher } from "@/components/auth/pending-watcher";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Aguardando aprovação" };

export default async function PendingPage() {
  const user = await requireUser();
  if (user.status === "approved") redirect("/dashboard");

  const rejected = user.status === "rejected";

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <div
          className={`mx-auto mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl ${
            rejected ? "border-bad/25 bg-bad-soft text-bad" : "border-warn/25 bg-warn-soft text-warn"
          }`}
        >
          {rejected ? "✕" : "⏳"}
        </div>

        <h1 className="headline text-3xl">
          {rejected ? "Acesso não autorizado" : "Aguardando aprovação"}
        </h1>

        <p className="text-ink-soft mt-3 text-sm leading-relaxed">
          {rejected ? (
            <>
              O acesso da conta <span className="text-ink font-medium">{user.email}</span> foi
              recusado por um administrador.
            </>
          ) : (
            <>
              Sua conta <span className="text-ink font-medium">{user.email}</span> foi criada e está
              na fila. Assim que um administrador aprovar, você entra automaticamente.
            </>
          )}
        </p>

        <div className="mt-7 flex flex-col items-center gap-4">
          {!rejected && <PendingWatcher />}
          <form action={signOutAction}>
            <button type="submit" className="btn-ghost">
              Sair
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
