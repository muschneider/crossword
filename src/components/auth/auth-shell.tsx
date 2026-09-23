import Link from "next/link";

import { LogoMark } from "@/components/icons";
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
          <Link href="/" className="text-ink mb-4 inline-flex" aria-label={env.APP_NAME}>
            <LogoMark size={48} />
          </Link>
          <h1 className="headline text-3xl">{title}</h1>
          {subtitle && (
            <p className="text-ink-soft mt-2 text-sm leading-relaxed text-balance">{subtitle}</p>
          )}
        </div>

        <div className="card p-6">{children}</div>

        {footer && <div className="text-ink-soft mt-5 text-center text-sm">{footer}</div>}

        <p className="headline text-ink-muted mt-8 text-center text-sm">{env.APP_NAME}</p>
      </div>
    </main>
  );
}
