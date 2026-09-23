import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { isEmailEnabled } from "@/lib/env";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; reset?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect(user.status === "approved" ? "/dashboard" : "/pending");

  const params = await searchParams;
  const callbackUrl =
    params.callbackUrl?.startsWith("/") && !params.callbackUrl.startsWith("//")
      ? params.callbackUrl
      : undefined;

  return (
    <AuthShell
      title="Entrar"
      subtitle="Palavras-cruzadas montadas com o seu próprio vocabulário de inglês."
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/signup" className="text-accent font-semibold hover:underline">
            Cadastre-se
          </Link>
        </>
      }
    >
      {params.reset === "1" && (
        <p role="status" className="notice-good mb-4">
          Senha redefinida. Entre com a nova senha.
        </p>
      )}

      <SignInForm callbackUrl={callbackUrl} emailEnabled={isEmailEnabled} />
    </AuthShell>
  );
}
