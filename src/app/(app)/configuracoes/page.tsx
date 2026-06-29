import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { getTenantContext } from "@/lib/tenant";
import { getUserById } from "@/server/services/user.service";
import { getAiCredentialStatus } from "@/server/services/ai-credential.service";
import { getAiUsageStatus } from "@/server/services/entitlements";
import { AccountSettings } from "@/components/app/AccountSettings";
import { CustomFieldsManager } from "@/components/CustomFieldsManager";
import { PipelineLabelsManager } from "@/components/PipelineLabelsManager";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const [user, ctx, aiKey] = await Promise.all([
    getUserById(userId),
    getTenantContext(),
    getAiCredentialStatus(userId),
  ]);
  if (!user) redirect("/login");

  // Operador sem canSettings: vê as configs da conta, mas não edita IA/funil/campos.
  const canSettings = ctx?.perms.canSettings ?? true;
  // Só o dono/ADMIN exporta ou exclui a conta inteira.
  const isOwner = ctx?.role === "ADMIN";

  // Consumo de IA é do DONO (tenant), não do operador logado.
  const aiUsage = await getAiUsageStatus(ctx?.tenantUserId ?? userId);

  return (
    <div className="mx-auto max-w-[720px]">
      <header className="mb-7">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Configurações</h1>
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
        aiKey={aiKey}
        aiUsage={aiUsage}
        canSettings={canSettings}
        isOwner={isOwner}
      />

      <div className="mt-6">
        <CustomFieldsManager canEdit={canSettings} />
      </div>

      <div className="mt-6">
        <PipelineLabelsManager canEdit={canSettings} />
      </div>
    </div>
  );
}
