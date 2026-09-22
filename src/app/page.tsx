import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

export default async function IndexPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status !== "approved") redirect("/pending");
  redirect("/dashboard");
}
