import { ChangePasswordForm, UpdateNameForm } from "@/components/auth/profile-forms";
import { ThemePicker } from "@/components/theme/theme-controls";
import { requireUser } from "@/lib/session";
import { getTheme } from "@/lib/theme-server";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const [user, theme] = await Promise.all([requireUser(), getTheme()]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="headline text-3xl">Perfil</h1>
        <p className="text-ink-soft mt-1 text-sm">{user.email}</p>
      </header>

      <UpdateNameForm defaultName={user.name} />
      <ThemePicker initial={theme} />
      <ChangePasswordForm />
    </div>
  );
}
