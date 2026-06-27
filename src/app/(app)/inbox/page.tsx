import { redirect } from "next/navigation";
import { getTenantUserId } from "@/lib/tenant";
import { InboxView } from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const userId = await getTenantUserId();
  if (!userId) redirect("/login");

  return <InboxView />;
}
