import Link from "next/link";

import { signOutAction } from "@/app/actions/auth";
import { AppNav } from "@/components/app-nav";
import { LogoMark } from "@/components/icons";
import { env } from "@/lib/env";
import { requireApprovedUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireApprovedUser();

  return (
    <div className="min-h-dvh">
      <header className="border-line bg-surface/95 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="text-ink flex shrink-0 items-center gap-2.5">
            <LogoMark size={30} />
            <span className="headline hidden text-lg md:inline">{env.APP_NAME}</span>
          </Link>

          <div className="flex-1">
            <AppNav isAdmin={user.role === "admin"} />
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              href="/perfil"
              title="Perfil"
              className="hover:bg-sunken flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors"
            >
              <span className="hidden text-right lg:block">
                <span className="text-ink block max-w-[12rem] truncate text-sm font-semibold">
                  {user.name}
                </span>
                <span className="text-ink-muted block max-w-[12rem] truncate text-xs">
                  {user.email}
                </span>
              </span>
              <span className="border-line-strong bg-paper text-ink flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold">
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
