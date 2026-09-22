import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { isEmailEnabled } from "@/lib/env";

export const metadata = { title: "Recuperar senha" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Informe o e-mail da conta e enviaremos um link para criar uma nova senha."
      footer={
        <Link href="/login" className="text-brand-400 font-semibold hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {isEmailEnabled ? (
        <ForgotPasswordForm />
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="mb-2 font-semibold">Envio de e-mail não configurado</p>
          <p className="leading-relaxed text-amber-200/80">
            Defina <code className="font-mono text-amber-100">SMTP_HOST</code>,{" "}
            <code className="font-mono text-amber-100">SMTP_USER</code> e{" "}
            <code className="font-mono text-amber-100">SMTP_PASSWORD</code> no{" "}
            <code className="font-mono text-amber-100">.env</code>. Enquanto isso, um administrador
            pode redefinir a senha pelo comando{" "}
            <code className="font-mono text-amber-100">mise run admin:password</code>.
          </p>
        </div>
      )}
    </AuthShell>
  );
}
