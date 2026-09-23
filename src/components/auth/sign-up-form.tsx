"use client";

import { useActionState } from "react";

import { signUpAction } from "@/app/actions/auth";
import { IDLE_STATE } from "@/lib/action-state";
import { Field, FormAlert } from "@/components/auth/form-controls";

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpAction, IDLE_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />

      <Field id="name" label="Nome" type="text" autoComplete="name" required autoFocus maxLength={80} />

      <Field
        id="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        required
        placeholder="voce@exemplo.com"
      />

      <Field
        id="password"
        label="Senha"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint="Mínimo de 8 caracteres, misturando letras e números."
      />

      <Field
        id="passwordConfirmation"
        label="Confirmar senha"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
      />

      <button type="submit" disabled={isPending} className="btn-primary w-full py-2.5">
        {isPending ? "Criando conta…" : "Criar conta"}
      </button>

      <p className="text-ink-muted text-center text-xs leading-relaxed">
        Sua conta ficará <span className="text-ink font-semibold">pendente</span> até que um
        administrador aprove o acesso.
      </p>
    </form>
  );
}
