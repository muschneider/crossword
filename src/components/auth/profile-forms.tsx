"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { changePasswordAction, updateProfileAction } from "@/app/actions/auth";
import { IDLE_STATE } from "@/lib/action-state";
import { Field, FormAlert } from "@/components/auth/form-controls";

export function UpdateNameForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(updateProfileAction, IDLE_STATE);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="card space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Seus dados</h2>
        <p className="text-ink-400 mt-1 text-xs">O e-mail da conta não pode ser alterado.</p>
      </div>

      <FormAlert state={state} />

      <Field id="name" label="Nome" type="text" defaultValue={defaultName} required maxLength={80} />

      <button type="submit" disabled={isPending} className="btn-primary">
        {isPending ? "Salvando…" : "Salvar"}
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(changePasswordAction, IDLE_STATE);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="card space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Alterar senha</h2>
        <p className="text-ink-400 mt-1 text-xs">
          Ao trocar a senha, todas as outras sessões são encerradas.
        </p>
      </div>

      <FormAlert state={state} />

      <Field
        id="currentPassword"
        label="Senha atual"
        type="password"
        autoComplete="current-password"
        required
      />

      <Field
        id="password"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        required
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

      <button type="submit" disabled={isPending} className="btn-primary">
        {isPending ? "Alterando…" : "Alterar senha"}
      </button>
    </form>
  );
}
