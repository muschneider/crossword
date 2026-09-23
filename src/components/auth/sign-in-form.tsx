"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signInAction } from "@/app/actions/auth";
import { IDLE_STATE } from "@/lib/action-state";
import { Field, FormAlert } from "@/components/auth/form-controls";

export function SignInForm({
  callbackUrl,
  emailEnabled,
}: {
  callbackUrl?: string;
  emailEnabled: boolean;
}) {
  const [state, formAction, isPending] = useActionState(signInAction, IDLE_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}

      <Field
        id="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        required
        autoFocus
        placeholder="voce@exemplo.com"
      />

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="password" className="label mb-0">
            Senha
          </label>
          {emailEnabled && (
            <Link href="/forgot-password" className="text-accent text-xs hover:underline">
              Esqueci minha senha
            </Link>
          )}
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          placeholder="••••••••"
        />
      </div>

      <button type="submit" disabled={isPending} className="btn-primary w-full py-2.5">
        {isPending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
