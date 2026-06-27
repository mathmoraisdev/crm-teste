import { prisma } from "@/server/db/client";
import type { LeadStatus } from "@prisma/client";
import { env } from "@/lib/env";
import { renderSpintax } from "@/lib/spintax";
import { assertFeature } from "@/server/services/entitlements";

/**
 * Status que podem (re)entrar numa campanha. Inclui CONTATADO (permite redisparo
 * para quem já foi abordado), mas PROTEGE conversas ativas/qualificadas/agendadas
 * e descartados — esses NÃO recebem disparo frio de campanha.
 */
const DISPATCHABLE_LEAD_STATUSES: LeadStatus[] = ["NOVO", "CONTATADO"];

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
    select: {
      id: true,
      name: true,
      messageTemplate: true,
      status: true,
      dailyCap: true,
      createdAt: true,
    },
  });
  const ids = campaigns.map((c) => c.id);
  if (ids.length === 0) return [];

  // Contagens agregadas no banco — não puxamos leads/jobs individuais (aguenta
  // campanhas com milhares de leads sem estourar a memória).
  const [leadCounts, novoCounts, jobCounts] = await Promise.all([
    prisma.lead.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids } }, _count: { _all: true } }),
    prisma.lead.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: ids }, status: "NOVO" },
      _count: { _all: true },
    }),
    prisma.outboundJob.groupBy({
      by: ["campaignId", "status"],
      where: { campaignId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const leadByCampaign = new Map<string, number>();
  for (const r of leadCounts) if (r.campaignId) leadByCampaign.set(r.campaignId, r._count._all);
  const novoByCampaign = new Map<string, number>();
  for (const r of novoCounts) if (r.campaignId) novoByCampaign.set(r.campaignId, r._count._all);

  const jobsByCampaign = new Map<string, { pending: number; sent: number; failed: number; total: number }>();
  for (const r of jobCounts) {
    if (!r.campaignId) continue;
    const acc = jobsByCampaign.get(r.campaignId) ?? { pending: 0, sent: 0, failed: 0, total: 0 };
    const n = r._count._all;
    acc.total += n;
    if (r.status === "PENDING" || r.status === "SENDING") acc.pending += n;
    else if (r.status === "SENT") acc.sent += n;
    else if (r.status === "FAILED") acc.failed += n;
    jobsByCampaign.set(r.campaignId, acc);
  }

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    messageTemplate: c.messageTemplate,
    status: c.status,
    dailyCap: c.dailyCap,
    leadCount: leadByCampaign.get(c.id) ?? 0,
    pendingCount: novoByCampaign.get(c.id) ?? 0,
    jobs: jobsByCampaign.get(c.id) ?? { pending: 0, sent: 0, failed: 0, total: 0 },
    createdAt: c.createdAt,
  }));
}

/**
 * Cria a campanha e associa os leads informados (ou todos os elegíveis sem
 * campanha, se nenhum id for passado). Elegível = status disparável
 * (NOVO ou CONTATADO — ver DISPATCHABLE_LEAD_STATUSES).
 */
export async function createCampaign(
  userId: string,
  opts: {
    name: string;
    messageTemplate: string;
    leadIds?: string[];
  },
): Promise<{ id: string; associated: number }> {
  await assertFeature(userId, "campaigns"); // entitlements: plano permite campanha?
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
      ? { userId, id: { in: opts.leadIds }, status: { in: DISPATCHABLE_LEAD_STATUSES } }
      : { userId, status: { in: DISPATCHABLE_LEAD_STATUSES } };

  const { count } = await prisma.lead.updateMany({
    where,
    data: { campaignId: campaign.id },
  });

  return { id: campaign.id, associated: count };
}

/**
 * Inicia a campanha ENFILEIRANDO um OutboundJob por lead disparável (NOVO ou
 * CONTATADO, não em opt-out) e marcando a campanha como `RUNNING`. O disparo em
 * si é feito pelo worker, respeitando rate limit, janela comercial e cap diário
 * — não há mais loop síncrono aqui.
 */
export async function startCampaign(
  campaignId: string,
  userId: string,
): Promise<{ enqueued: number }> {
  await assertFeature(userId, "campaigns"); // entitlements: plano permite campanha?
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
    include: {
      leads: {
        where: { status: { in: DISPATCHABLE_LEAD_STATUSES }, optOut: false },
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
 *
 * Além de editar, **puxa para a campanha os leads elegíveis que ainda não têm
 * campanha** (status disparável + `campaignId` nulo). Isso resolve o caso de
 * leads criados DEPOIS da campanha: salvar a edição reassocia-os. Só pega leads
 * órfãos — nunca rouba leads já vinculados a outra campanha. Retorna quantos
 * foram associados nesta chamada.
 */
export async function updateCampaign(
  id: string,
  userId: string,
  data: { name?: string; messageTemplate?: string; dailyCap?: number | null },
): Promise<{ associated: number }> {
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

  const { count } = await prisma.lead.updateMany({
    where: { userId, campaignId: null, status: { in: DISPATCHABLE_LEAD_STATUSES } },
    data: { campaignId: id },
  });

  return { associated: count };
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
