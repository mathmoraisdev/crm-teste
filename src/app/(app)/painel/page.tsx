import { redirect } from "next/navigation";
import { getTenantUserId } from "@/lib/tenant";
import { DashboardView } from "@/components/DashboardView";

export const dynamic = "force-dynamic";

export default async function PainelPage() {
  const userId = await getTenantUserId();
  if (!userId) redirect("/login");

  return <DashboardView />;
}
