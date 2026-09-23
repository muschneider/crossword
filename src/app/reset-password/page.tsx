import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { inspectResetToken, RESET_TTL_MINUTES } from "@/lib/password-reset";

export const metadata = { title: "Nova senha" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const check = await inspectResetToken(token);

  if (!check.valid) {
    return (
      <AuthShell
        title="Link inválido"
        subtitle={check.reason}
        footer={
          <Link href="/forgot-password" className="text-accent font-semibold hover:underline">
            Pedir um novo link
          </Link>
        }
      >
        <p className="text-ink-soft text-sm leading-relaxed">
          Links de recuperação valem por {RESET_TTL_MINUTES} minutos e só podem ser usados uma vez.
          Peça um novo para continuar.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Criar nova senha"
      subtitle={
        <>
          Definindo a senha de <span className="text-ink font-medium">{check.email}</span>.
        </>
      }
      footer={
        <Link href="/login" className="text-accent font-semibold hover:underline">
          Voltar para o login
        </Link>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
