import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { InboxView } from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  return <InboxView canSettings={ctx.perms.canSettings} />;
}
