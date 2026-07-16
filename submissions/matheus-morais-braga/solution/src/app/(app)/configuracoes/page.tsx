import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { getTenantContext } from "@/lib/tenant";
import { getUserById } from "@/server/services/user.service";
import { getAiCredentialStatus } from "@/server/services/ai-credential.service";
import { getPaymentCredentialStatus } from "@/server/services/payment-credential.service";
import { getFiscalCredentialStatus } from "@/server/services/fiscal-credential.service";
import { getAiUsageStatus, canUseFeature } from "@/server/services/entitlements";
import { AccountSettings } from "@/components/app/AccountSettings";
import { CustomFieldsManager } from "@/components/CustomFieldsManager";
import { PipelineLabelsManager } from "@/components/PipelineLabelsManager";
import { BrandingSettings } from "@/components/app/BrandingSettings";
import { getBranding } from "@/server/services/branding.service";
import { BusinessCategorySettings } from "@/components/app/BusinessCategorySettings";
import { VerticalOnboardingWizard } from "@/components/VerticalOnboardingWizard";
import { getBusinessTemplateId } from "@/server/services/account.service";
import { env } from "@/lib/env";

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
  // Chaves de pagamento/fiscal são financeiras — gate separado (coerência com o servidor).
  const canFinance = ctx?.perms.canFinance ?? true;
  // Só o dono/ADMIN exporta ou exclui a conta inteira.
  const isOwner = ctx?.role === "ADMIN";

  // Consumo de IA é do DONO (tenant), não do operador logado.
  const ownerId = ctx?.tenantUserId ?? userId;
  const [aiUsage, paymentKey, fiscalKey, salesAllowed, branding, businessTemplateId] = await Promise.all([
    getAiUsageStatus(ownerId),
    getPaymentCredentialStatus(ownerId), // credencial de pagamento é do dono
    getFiscalCredentialStatus(ownerId), // credencial/perfil fiscal é do dono (BYOK dentro de AccountSettings)
    canUseFeature(ownerId, "sales"), // funil de vendas só em planos que permitem
    getBranding(ownerId), // identidade visual da conta (só o dono edita)
    getBusinessTemplateId(ownerId), // ramo do negócio da conta (só o dono edita)
  ]);

  return (
    <div className="mx-auto max-w-[720px]">
      <header className="mb-7">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Configurações</h1>
        <p className="mt-1 text-sm text-slate-500">
          Config global da conta. A config de cada módulo mora dentro dele (Agenda, Atendimento, Caixa).
        </p>
        <a
          href="/configuracoes/delivery"
          className="mt-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
        >
          Cardápio & Delivery →
        </a>
      </header>

      <AccountSettings
        account={{
          name: user.name,
          email: user.email,
          whatsapp: user.whatsapp,
          emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
          createdAt: user.createdAt.toISOString(),
          accessUntil: user.accessUntil ? user.accessUntil.toISOString() : null,
          cancelRequestedAt: user.cancelRequestedAt ? user.cancelRequestedAt.toISOString() : null,
        }}
        aiKey={aiKey}
        aiUsage={aiUsage}
        paymentKey={paymentKey}
        fiscalKey={fiscalKey}
        fiscalEmissionGlobal={env.FISCAL_EMISSION}
        salesAllowed={salesAllowed}
        canSettings={canSettings}
        canFinance={canFinance}
        isOwner={isOwner}
      />

      {isOwner && (
        <div className="mt-6">
          <BusinessCategorySettings canEdit={canSettings} initial={businessTemplateId} />
        </div>
      )}

      {isOwner && (
        <div className="mt-6">
          <VerticalOnboardingWizard initial={businessTemplateId} canEdit={canSettings} />
        </div>
      )}

      {isOwner && (
        <div className="mt-6">
          <BrandingSettings
            initial={{
              presetId: branding.presetId ?? null,
              appName: branding.appName,
              logoUrl: branding.logoUrl,
              publicTheme: branding.publicTheme,
              businessAddress: branding.businessAddress,
            }}
          />
        </div>
      )}

      <div className="mt-6">
        <CustomFieldsManager canEdit={canSettings} businessTemplateId={businessTemplateId} />
      </div>

      <div className="mt-6">
        <PipelineLabelsManager canEdit={canSettings} />
      </div>
    </div>
  );
}
