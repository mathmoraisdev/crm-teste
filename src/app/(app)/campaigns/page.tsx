import { CampaignsView } from "@/components/CampaignsView";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const ctx = await getTenantContext();
  // Operador sem permissão vê as campanhas, mas não cria nem dispara.
  return <CampaignsView canCampaigns={ctx?.perms.canCampaigns ?? true} />;
}
