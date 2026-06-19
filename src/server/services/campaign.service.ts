import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { renderSpintax } from "@/lib/spintax";

export interface CampaignListItem {
  id: string;
  name: string;
  messageTemplate: string;
  status: string;
  dailyCap: number | null;
  leadCount: number;
  pendingCount: number; // leads ainda NOVO (não disparados)
  jobs: { pending: number; sent: number; failed: number; total: number };
  createdAt: Date;
}

/** Renderiza o template substituindo {{nome}} pelo nome do lead. */
export function renderTemplate(template: string, name: string): string {
  return template.replace(/\{\{\s*nome\s*\}\}/gi, name);
}

export async function listCampaigns(userId: string): Promise<CampaignListItem[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      leads: { select: { status: true } },
      outboundJobs: { select: { status: true } },
    },
  });
  return campaigns.map((c) => {
    const jobs = c.outboundJobs;
    return {
      id: c.id,
      name: c.name,
      messageTemplate: c.messageTemplate,
      status: c.status,
      dailyCap: c.dailyCap,
      leadCount: c.leads.length,
      pendingCount: c.leads.filter((l) => l.status === "NOVO").length,
      jobs: {
        pending: jobs.filter(
          (j) => j.status === "PENDING" || j.status === "SENDING",
        ).length,
        sent: jobs.filter((j) => j.status === "SENT").length,
        failed: jobs.filter((j) => j.status === "FAILED").length,
        total: jobs.length,
      },
      createdAt: c.createdAt,
    };
  });
}

/**
 * Cria a campanha e associa os leads `NOVO` informados (ou todos os `NOVO`
 * sem campanha, se nenhum id for passado).
 */
export async function createCampaign(
  userId: string,
  opts: {
    name: string;
    messageTemplate: string;
    leadIds?: string[];
  },
): Promise<{ id: string; associated: number }> {
  const campaign = await prisma.campaign.create({
    data: {
      userId,
      name: opts.name,
      messageTemplate: opts.messageTemplate,
      status: "DRAFT",
    },
  });

  const where =
    opts.leadIds && opts.leadIds.length > 0
      ? { userId, id: { in: opts.leadIds }, status: "NOVO" as const }
      : { userId, status: "NOVO" as const };

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
  userId: string,
): Promise<{ enqueued: number }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
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
        // spin primeiro ({a|b} aleatório por lead), nome depois ({{nome}})
        content: renderTemplate(renderSpintax(campaign.messageTemplate), lead.name),
        templateName: useTemplate ? env.WHATSAPP_TEMPLATE_NAME : null,
      })),
    }),
  ]);

  return { enqueued: campaign.leads.length };
}

/**
 * Edita os dados da campanha. A mensagem nova só afeta envios FUTUROS — os
 * jobs já enfileirados mantêm o texto renderizado na hora do disparo.
 * `dailyCap: null` volta a usar o default do env.
 */
export async function updateCampaign(
  id: string,
  userId: string,
  data: { name?: string; messageTemplate?: string; dailyCap?: number | null },
): Promise<void> {
  const exists = await prisma.campaign.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw new Error("Campanha não encontrada");
  await prisma.campaign.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.messageTemplate !== undefined ? { messageTemplate: data.messageTemplate } : {}),
      ...(data.dailyCap !== undefined ? { dailyCap: data.dailyCap } : {}),
    },
  });
}

/**
 * Apaga a campanha de forma segura: cancela os envios ainda PENDENTES/SENDING
 * (para não dispararem após a remoção), desvincula os leads (preservados, voltam
 * a ficar sem campanha) e remove a campanha. O histórico de enviados é mantido,
 * apenas desassociado (via SetNull no campaignId do OutboundJob).
 */
export async function deleteCampaign(id: string, userId: string): Promise<void> {
  const exists = await prisma.campaign.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw new Error("Campanha não encontrada");
  await prisma.$transaction([
    prisma.outboundJob.updateMany({
      where: { campaignId: id, status: { in: ["PENDING", "SENDING"] } },
      data: { status: "CANCELLED" },
    }),
    prisma.lead.updateMany({ where: { campaignId: id }, data: { campaignId: null } }),
    prisma.campaign.delete({ where: { id } }),
  ]);
}
