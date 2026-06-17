import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";

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
 * Inicia a campanha ENFILEIRANDO um OutboundJob por lead `NOVO` (não em opt-out)
 * e marcando a campanha como `RUNNING`. O disparo em si é feito pelo worker,
 * respeitando rate limit, janela comercial e cap diário — não há mais loop
 * síncrono aqui.
 */
export async function startCampaign(
  campaignId: string,
): Promise<{ enqueued: number }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      leads: {
        where: { status: "NOVO", optOut: false },
        select: { id: true, name: true },
      },
    },
  });
  if (!campaign) throw new Error("Campanha não encontrada");

  const useTemplate = !!env.WHATSAPP_TEMPLATE_NAME && env.WHATSAPP_MODE === "cloud-api";

  await prisma.$transaction([
    prisma.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING" } }),
    prisma.outboundJob.createMany({
      data: campaign.leads.map((lead) => ({
        leadId: lead.id,
        campaignId,
        kind: useTemplate ? "template" : "freeform",
        content: renderTemplate(campaign.messageTemplate, lead.name),
        templateName: useTemplate ? env.WHATSAPP_TEMPLATE_NAME : null,
      })),
    }),
  ]);

  return { enqueued: campaign.leads.length };
}
