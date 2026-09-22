import Link from "next/link";

import { env } from "@/lib/env";

/**
 * Server Component: reads server-only env, so it must never be imported from a
 * `"use client"` module. The shared form primitives live in
 * `@/components/auth/form-controls` precisely so the client forms can import
 * them without dragging `@/lib/env` into the browser bundle.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <Link
            href="/"
            className="border-brand-500/30 bg-brand-500/10 text-brand-400 mb-4 inline-flex h-13 w-13 items-center justify-center rounded-2xl border p-3 text-2xl font-black"
          >
            ✶
          </Link>
          <h1 className="text-2xl font-black tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-ink-300 mt-2 text-sm leading-relaxed text-balance">{subtitle}</p>
          )}
        </div>

        <div className="card p-6">{children}</div>

        {footer && <div className="text-ink-400 mt-5 text-center text-sm">{footer}</div>}

        <p className="text-ink-400 mt-8 text-center text-xs">{env.APP_NAME}</p>
      </div>
    </main>
  );
}
