import { LeadDetailView } from "@/components/LeadDetailView";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LeadDetailView leadId={id} />;
}
