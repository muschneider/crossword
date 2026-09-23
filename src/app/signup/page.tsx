import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "Criar conta" };

export default async function SignUpPage() {
  const user = await getSessionUser();
  if (user) redirect(user.status === "approved" ? "/dashboard" : "/pending");

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Cada pessoa tem seu próprio vocabulário e seus próprios crosswords."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/login" className="text-accent font-semibold hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
