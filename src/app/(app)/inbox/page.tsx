import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/server/db/client";
import { InboxView } from "@/components/inbox/InboxView";
import { SetupRequired } from "@/components/app/SetupRequired";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  // Gate contextual: sem número conectado, o Atendimento não tem por onde
  // receber/enviar. Bloqueia só ESTA tela (não o app), apontando o caminho.
  const numbers = await prisma.whatsAppNumber.count({ where: { userId: ctx.tenantUserId } });
  if (numbers === 0) {
    return (
      <SetupRequired
        icon={MessageSquare}
        title="Conecte um número para atender"
        description="O Atendimento precisa de um WhatsApp conectado para receber e responder mensagens."
        href="/empresas"
        cta="Conectar número"
        canSettings={ctx.perms.canSettings}
      />
    );
  }

  return <InboxView canSettings={ctx.perms.canSettings} />;
}
