import { ChangePasswordForm, UpdateNameForm } from "@/components/auth/profile-forms";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-black tracking-tight">Perfil</h1>
        <p className="text-ink-300 mt-1 text-sm">{user.email}</p>
      </header>

      <UpdateNameForm defaultName={user.name} />
      <ChangePasswordForm />
    </div>
  );
}
