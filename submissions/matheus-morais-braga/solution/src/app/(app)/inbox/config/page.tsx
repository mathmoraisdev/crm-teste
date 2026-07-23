import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTenantContext } from "@/lib/tenant";
import { getInboxSlaMinutes } from "@/server/services/account.service";
import { QuickRepliesSettings } from "@/components/inbox/QuickRepliesSettings";
import { InboxSlaSettings } from "@/components/inbox/InboxSlaSettings";
import { MediaLibrarySettings } from "@/components/app/MediaLibrarySettings";

export const dynamic = "force-dynamic";

export default async function InboxConfigPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  // Config do Atendimento é do dono/gerente (mesmo gate de Configurações).
  if (!ctx.perms.canSettings) redirect("/inbox");

  const inboxSla = await getInboxSlaMinutes(ctx.tenantUserId);

  return (
    <div className="mx-auto max-w-[720px]">
      <header className="mb-7">
        <Link
          href="/inbox"
          className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand-600"
        >
          <ChevronLeft size={15} /> Voltar ao Atendimento
        </Link>
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">
          Configurar Atendimento
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Respostas rápidas, meta de SLA e biblioteca de mídia.
        </p>
      </header>

      <div className="space-y-6">
        <QuickRepliesSettings canEdit={ctx.perms.canSettings} />
        <InboxSlaSettings initial={inboxSla} canEdit={ctx.perms.canSettings} />
        <MediaLibrarySettings canEdit={ctx.perms.canSettings} />
      </div>
    </div>
  );
}
