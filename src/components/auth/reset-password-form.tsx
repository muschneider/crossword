"use client";

import { useActionState } from "react";

import { resetPasswordAction } from "@/app/actions/auth";
import { IDLE_STATE } from "@/lib/action-state";
import { Field, FormAlert } from "@/components/auth/form-controls";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(resetPasswordAction, IDLE_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      <input type="hidden" name="token" value={token} />

      <Field
        id="password"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        required
        autoFocus
        minLength={8}
        hint="Mínimo de 8 caracteres, misturando letras e números."
      />

      <Field
        id="passwordConfirmation"
        label="Confirmar nova senha"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
      />

      <button type="submit" disabled={isPending} className="btn-primary w-full py-2.5">
        {isPending ? "Salvando…" : "Salvar nova senha"}
      </button>

      <p className="text-ink-400 text-center text-xs leading-relaxed">
        Por segurança, todas as sessões abertas serão encerradas.
      </p>
    </form>
  );
}
