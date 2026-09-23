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
        <Link href="/login" className="text-accent font-semibold hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {isEmailEnabled ? (
        <ForgotPasswordForm />
      ) : (
        <div className="notice-warn p-4">
          <p className="mb-2 font-semibold">Envio de e-mail não configurado</p>
          <p>
            Defina <code className="font-mono">SMTP_HOST</code>,{" "}
            <code className="font-mono">SMTP_USER</code> e{" "}
            <code className="font-mono">SMTP_PASSWORD</code> no{" "}
            <code className="font-mono">.env</code>. Enquanto isso, um administrador pode redefinir
            a senha pelo comando <code className="font-mono">mise run admin:password</code>.
          </p>
        </div>
      )}
    </AuthShell>
  );
}
