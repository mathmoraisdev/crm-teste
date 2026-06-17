import { prisma } from "@/server/db/client";
import { sendWhatsAppMessage } from "./messaging";

export interface CampaignListItem {
  id: string;
  name: string;
  messageTemplate: string;
  status: string;
  leadCount: number;
  pendingCount: number; // leads ainda NOVO (não disparados)
  createdAt: Date;
}

/** Renderiza o template substituindo {{nome}} pelo nome do lead. */
export function renderTemplate(template: string, name: string): string {
  return template.replace(/\{\{\s*nome\s*\}\}/gi, name);
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      leads: { select: { status: true } },
    },
  });
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    messageTemplate: c.messageTemplate,
    status: c.status,
    leadCount: c.leads.length,
    pendingCount: c.leads.filter((l) => l.status === "NOVO").length,
    createdAt: c.createdAt,
  }));
}

/**
 * Cria a campanha e associa os leads `NOVO` informados (ou todos os `NOVO`
 * sem campanha, se nenhum id for passado).
 */
export async function createCampaign(opts: {
  name: string;
  messageTemplate: string;
  leadIds?: string[];
}): Promise<{ id: string; associated: number }> {
  const campaign = await prisma.campaign.create({
    data: {
      name: opts.name,
      messageTemplate: opts.messageTemplate,
      status: "DRAFT",
    },
  });

  const where =
    opts.leadIds && opts.leadIds.length > 0
      ? { id: { in: opts.leadIds }, status: "NOVO" as const }
      : { status: "NOVO" as const };

  const { count } = await prisma.lead.updateMany({
    where,
    data: { campaignId: campaign.id },
  });

  return { id: campaign.id, associated: count };
}

/**
 * Dispara as mensagens iniciais da campanha: para cada lead `NOVO` associado,
 * renderiza o template, envia via WhatsApp (mock/real), persiste OUTBOUND e
 * move o lead para `CONTATADO`. Marca a campanha como COMPLETED ao final.
 */
export async function startCampaign(
  campaignId: string,
): Promise<{ sent: number; skipped: number }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      leads: { where: { status: "NOVO" }, select: { id: true, name: true, phone: true } },
    },
  });
  if (!campaign) throw new Error("Campanha não encontrada");

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "RUNNING" },
  });

  let sent = 0;
  let skipped = 0;
  for (const lead of campaign.leads) {
    try {
      const text = renderTemplate(campaign.messageTemplate, lead.name);
      await sendWhatsAppMessage(lead, text);
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: "CONTATADO" },
      });
      sent++;
    } catch (e) {
      console.error(`Falha ao disparar para ${lead.name}:`, e);
      skipped++;
    }
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "COMPLETED" },
  });

  return { sent, skipped };
}
