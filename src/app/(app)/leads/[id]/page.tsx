import { LeadDetailView } from "@/components/LeadDetailView";
import { env } from "@/lib/env";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LeadDetailView leadId={id} canSimulate={env.WHATSAPP_MODE === "mock"} />;
}
