import { CampaignsView } from "@/components/CampaignsView";
import { getTenantContext } from "@/lib/tenant";
import { getLifecycleAutomationEnabled } from "@/server/services/account.service";
import { LifecycleSettings } from "@/components/app/LifecycleSettings";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const ctx = await getTenantContext();
  // Operador sem permissão vê as campanhas, mas não cria nem dispara.
  const canCampaigns = ctx?.perms.canCampaigns ?? true;
  // Automações de ciclo de vida (pós-venda/NPS/reengajamento) são outbound
  // automático — moram perto das campanhas. Opt-in é do dono (canSettings).
  const canSettings = ctx?.perms.canSettings ?? false;
  const lifecycleEnabled = ctx ? await getLifecycleAutomationEnabled(ctx.tenantUserId) : false;

  return (
    <div className="space-y-8">
      <CampaignsView canCampaigns={canCampaigns} />
      {canSettings && (
        <section>
          <h2 className="mb-3 font-display text-lg font-bold tracking-[-0.02em] text-ink">Automações</h2>
          <LifecycleSettings initial={lifecycleEnabled} canEdit={canSettings} />
        </section>
      )}
    </div>
  );
}
