import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { AccountSettings } from "@/components/app/AccountSettings";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const user = await getUserById(userId);
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-[720px]">
      <header className="mb-7">
        <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] text-ink">Configurações</h1>
        <p className="mt-1 text-sm text-slate-500">Gerencie sua conta, seus dados e suas preferências.</p>
      </header>

      <AccountSettings
        account={{
          name: user.name,
          email: user.email,
          whatsapp: user.whatsapp,
          emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
          createdAt: user.createdAt.toISOString(),
        }}
      />
    </div>
  );
}
