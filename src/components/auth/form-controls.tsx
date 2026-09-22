/**
 * Presentational form primitives shared by the auth forms.
 *
 * These are imported by `"use client"` components, so this module must stay
 * free of server-only imports (`@/lib/env`, `@/db`, repositories, …). Anything
 * pulled in here ends up in the browser bundle.
 */

export function FormAlert({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`mb-4 rounded-xl border px-4 py-3 text-sm leading-relaxed ${
        state.ok
          ? "border-brand-500/30 bg-brand-500/10 text-brand-400"
          : "border-red-500/30 bg-red-500/10 text-red-300"
      }`}
    >
      {state.message}
    </p>
  );
}

export function Field({
  id,
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} name={id} className="input" {...props} />
      {hint && <p className="text-ink-400 mt-1.5 text-xs">{hint}</p>}
    </div>
  );
}
