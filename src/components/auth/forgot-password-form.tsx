"use client";

import { useActionState } from "react";

import { requestPasswordResetAction } from "@/app/actions/auth";
import { IDLE_STATE } from "@/lib/action-state";
import { Field, FormAlert } from "@/components/auth/form-controls";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    IDLE_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      {!state.ok && (
        <>
          <Field
            id="email"
            label="E-mail da conta"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="voce@exemplo.com"
          />

          <button type="submit" disabled={isPending} className="btn-primary w-full py-2.5">
            {isPending ? "Enviando…" : "Enviar link de recuperação"}
          </button>
        </>
      )}
    </form>
  );
}
