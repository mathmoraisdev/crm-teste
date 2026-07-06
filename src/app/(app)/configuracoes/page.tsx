import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { getTenantContext } from "@/lib/tenant";
import { getUserById } from "@/server/services/user.service";
import { getAiCredentialStatus } from "@/server/services/ai-credential.service";
import { getPaymentCredentialStatus } from "@/server/services/payment-credential.service";
import { getAiUsageStatus, canUseFeature } from "@/server/services/entitlements";
import { AccountSettings } from "@/components/app/AccountSettings";
import { CustomFieldsManager } from "@/components/CustomFieldsManager";
import { PipelineLabelsManager } from "@/components/PipelineLabelsManager";
import { BrandingSettings } from "@/components/app/BrandingSettings";
import { getBranding } from "@/server/services/branding.service";
import { PosPrintSettings } from "@/components/app/PosPrintSettings";
import { getPosSettings } from "@/server/services/pos-settings.service";
import { BusinessCategorySettings } from "@/components/app/BusinessCategorySettings";
import { getBusinessTemplateId, getInboxSlaMinutes } from "@/server/services/account.service";
import { QuickRepliesSettings } from "@/components/inbox/QuickRepliesSettings";
import { InboxSlaSettings } from "@/components/inbox/InboxSlaSettings";
import { ProfessionalsSettings } from "@/components/app/ProfessionalsSettings";
import { MediaLibrarySettings } from "@/components/app/MediaLibrarySettings";

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
  const ownerId = ctx?.tenantUserId ?? userId;
  const [aiUsage, paymentKey, salesAllowed, branding, businessTemplateId, posSettings, inboxSla] = await Promise.all([
    getAiUsageStatus(ownerId),
    getPaymentCredentialStatus(ownerId), // credencial de pagamento é do dono
    canUseFeature(ownerId, "sales"), // funil de vendas só em planos que permitem
    getBranding(ownerId), // identidade visual da conta (só o dono edita)
    getBusinessTemplateId(ownerId), // ramo do negócio da conta (só o dono edita)
    getPosSettings(ownerId), // config de impressão de cupom (só o dono edita)
    getInboxSlaMinutes(ownerId), // meta de SLA do inbox (só o dono edita)
  ]);

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
          accessUntil: user.accessUntil ? user.accessUntil.toISOString() : null,
          cancelRequestedAt: user.cancelRequestedAt ? user.cancelRequestedAt.toISOString() : null,
        }}
        aiKey={aiKey}
        aiUsage={aiUsage}
        paymentKey={paymentKey}
        salesAllowed={salesAllowed}
        canSettings={canSettings}
        isOwner={isOwner}
      />

      {isOwner && (
        <div className="mt-6">
          <BusinessCategorySettings canEdit={canSettings} initial={businessTemplateId} />
        </div>
      )}

      {isOwner && (
        <div className="mt-6">
          <BrandingSettings
            initial={{
              presetId: branding.presetId ?? null,
              appName: branding.appName,
              logoUrl: branding.logoUrl,
            }}
          />
        </div>
      )}

      {isOwner && (
        <div className="mt-6">
          <PosPrintSettings initial={posSettings} />
        </div>
      )}

      <div className="mt-6">
        <CustomFieldsManager canEdit={canSettings} businessTemplateId={businessTemplateId} />
      </div>

      <div className="mt-6">
        <PipelineLabelsManager canEdit={canSettings} />
      </div>

      {(isOwner || canSettings) && (
        <div className="mt-6">
          <ProfessionalsSettings canEdit={canSettings} />
        </div>
      )}

      <div className="mt-6">
        <QuickRepliesSettings canEdit={canSettings} />
      </div>

      {(isOwner || canSettings) && (
        <div className="mt-6">
          <MediaLibrarySettings canEdit={canSettings} />
        </div>
      )}

      {isOwner && (
        <div className="mt-6">
          <InboxSlaSettings initial={inboxSla} canEdit={canSettings} />
        </div>
      )}
    </div>
  );
}
