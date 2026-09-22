import Link from "next/link";

import { signOutAction } from "@/app/actions/auth";
import { AppNav } from "@/components/app-nav";
import { env } from "@/lib/env";
import { requireApprovedUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireApprovedUser();

  return (
    <div className="min-h-dvh">
      <header className="border-ink-800/80 bg-ink-950/80 sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
            <span className="border-brand-500/30 bg-brand-500/10 text-brand-400 flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-black">
              ✶
            </span>
            <span className="hidden text-sm font-black tracking-tight md:inline">
              {env.APP_NAME}
            </span>
          </Link>

          <div className="flex-1">
            <AppNav isAdmin={user.role === "admin"} />
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/perfil"
              title="Perfil"
              className="hover:bg-ink-800 flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors"
            >
              <span className="hidden text-right lg:block">
                <span className="text-ink-100 block max-w-[12rem] truncate text-sm font-semibold">
                  {user.name}
                </span>
                <span className="text-ink-400 block max-w-[12rem] truncate text-xs">
                  {user.email}
                </span>
              </span>
              <span className="bg-ink-700 text-ink-200 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </Link>

            <form action={signOutAction}>
              <button type="submit" className="btn-ghost px-2.5" title="Sair">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
