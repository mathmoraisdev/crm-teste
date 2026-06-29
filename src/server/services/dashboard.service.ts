import { prisma } from "@/server/db/client";
import type { LeadStatus } from "@prisma/client";
import { PIPELINE_ORDER } from "@/lib/leadStatus";

export interface FunnelStage {
  status: LeadStatus;
  count: number;
}

export interface CompanyRow {
  whatsAppNumberId: string | null;
  name: string;
  leads: number;
}

export interface CampaignRow {
  campaignId: string | null;
  name: string;
  sent: number;
  failed: number;
}

export interface DailyPoint {
  day: string; // YYYY-MM-DD
  count: number;
}

export interface DashboardData {
  days: number;
  totals: {
    leads: number;
    qualified: number;
    meetings: number;
    confirmedMeetings: number;
    inbound: number;
    outbound: number;
  };
  rates: {
    qualifiedRate: number; // qualificados / total
    meetingRate: number; // reuniões / qualificados
  };
  funnel: FunnelStage[];
  newLeadsPerDay: DailyPoint[];
  byCompany: CompanyRow[];
  byCampaign: CampaignRow[];
  sla: {
    avgFirstResponseSeconds: number | null; // tempo médio até a 1ª resposta humana (handoff → operador)
    sampleSize: number;
  };
  aiSla: {
    avgResponseSeconds: number | null; // tempo médio de resposta da IA (msg do lead → resposta da IA)
    sampleSize: number; // nº de respostas da IA pareadas no período
  };
  resolvedByAgent: AgentRow[];
}

export interface AgentRow {
  agentId: string | null;
  name: string;
  resolved: number;
}

/** Divisão segura: nunca divide por zero. */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Métricas do painel da conta no período (default 30 dias). Usa groupBy/count
 * (sem N+1). Taxas nunca dividem por zero.
 */
export async function getDashboard(
  userId: string,
  opts: { days?: number } = {},
): Promise<DashboardData> {
  const days = Math.max(1, Math.min(365, opts.days ?? 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    funnelGroups,
    messageGroups,
    newLeads,
    companyGroups,
    numbers,
    jobGroups,
    campaigns,
    confirmedMeetings,
  ] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
    prisma.message.groupBy({
      by: ["direction"],
      where: { lead: { userId }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.lead.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.lead.groupBy({ by: ["whatsAppNumberId"], where: { userId }, _count: { _all: true } }),
    prisma.whatsAppNumber.findMany({
      where: { userId },
      select: { id: true, label: true, displayName: true },
    }),
    prisma.outboundJob.groupBy({
      by: ["campaignId", "status"],
      where: { lead: { userId }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.campaign.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.meeting.count({
      where: { lead: { userId }, status: "CONFIRMED", scheduledAt: { gte: since } },
    }),
  ]);

  // SLA de 1ª resposta humana + resolvidas por atendente + mensagens p/ o SLA da IA.
  const [slaLeads, resolvedGroups, members, aiSlaMessages] = await Promise.all([
    prisma.lead.findMany({
      where: { userId, queuedAt: { not: null }, firstResponseAt: { not: null, gte: since } },
      select: { queuedAt: true, firstResponseAt: true },
    }),
    prisma.lead.groupBy({
      by: ["assignedToId"],
      where: { userId, attendanceStatus: "RESOLVIDA", firstResponseAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { OR: [{ id: userId }, { ownerId: userId }] },
      select: { id: true, name: true },
    }),
    // Para o SLA da IA: todo INBOUND do lead + toda resposta OUTBOUND da IA no
    // período, em ordem cronológica por conversa (pareamento em JS abaixo).
    prisma.message.findMany({
      where: {
        lead: { userId },
        createdAt: { gte: since },
        OR: [{ direction: "INBOUND" }, { direction: "OUTBOUND", source: "AI" }],
      },
      select: { leadId: true, direction: true, createdAt: true },
      orderBy: [{ leadId: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  let slaSum = 0;
  for (const l of slaLeads) {
    if (l.queuedAt && l.firstResponseAt) {
      slaSum += (l.firstResponseAt.getTime() - l.queuedAt.getTime()) / 1000;
    }
  }
  const sla = {
    avgFirstResponseSeconds: slaLeads.length > 0 ? Math.round(slaSum / slaLeads.length) : null,
    sampleSize: slaLeads.length,
  };

  // SLA da IA: pareia cada resposta da IA ao 1º INBOUND ainda não respondido da
  // mesma conversa (o "abre" da rajada — espelha o debounce: a IA junta mensagens
  // picadas e mede do início da rajada). Latência = resposta − abertura.
  let aiSum = 0;
  let aiCount = 0;
  let aiLead: string | null = null;
  let openInboundAt: Date | null = null;
  for (const m of aiSlaMessages) {
    if (m.leadId !== aiLead) {
      aiLead = m.leadId;
      openInboundAt = null;
    }
    if (m.direction === "INBOUND") {
      if (!openInboundAt) openInboundAt = m.createdAt; // 1º inbound da rajada
    } else if (openInboundAt) {
      // resposta da IA fechando uma rajada aberta
      aiSum += (m.createdAt.getTime() - openInboundAt.getTime()) / 1000;
      aiCount += 1;
      openInboundAt = null;
    }
  }
  const aiSla = {
    avgResponseSeconds: aiCount > 0 ? Math.round(aiSum / aiCount) : null,
    sampleSize: aiCount,
  };

  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const resolvedByAgent: AgentRow[] = resolvedGroups
    .map((g) => ({
      agentId: g.assignedToId,
      name: g.assignedToId ? memberName.get(g.assignedToId) ?? "—" : "Sem atribuição",
      resolved: g._count._all,
    }))
    .sort((a, b) => b.resolved - a.resolved);

  // Funil (na ordem do pipeline).
  const countByStatus = new Map<LeadStatus, number>();
  for (const g of funnelGroups) countByStatus.set(g.status, g._count._all);
  const funnel: FunnelStage[] = PIPELINE_ORDER.map((status) => ({
    status,
    count: countByStatus.get(status) ?? 0,
  }));

  const totalLeads = funnel.reduce((s, f) => s + f.count, 0);
  const qualified = (countByStatus.get("QUALIFICADO") ?? 0) + (countByStatus.get("REUNIAO_AGENDADA") ?? 0);
  const meetings = countByStatus.get("REUNIAO_AGENDADA") ?? 0;

  // Volume de mensagens por direção (no período).
  let inbound = 0;
  let outbound = 0;
  for (const g of messageGroups) {
    if (g.direction === "INBOUND") inbound = g._count._all;
    else if (g.direction === "OUTBOUND") outbound = g._count._all;
  }

  // Novos leads por dia (bucket em JS — período é curto).
  const perDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    perDay.set(dayKey(d), 0);
  }
  for (const l of newLeads) {
    const k = dayKey(l.createdAt);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const newLeadsPerDay: DailyPoint[] = [...perDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));

  // Por empresa (número).
  const numberName = new Map(numbers.map((n) => [n.id, n.displayName?.trim() || n.label]));
  const byCompany: CompanyRow[] = companyGroups
    .map((g) => ({
      whatsAppNumberId: g.whatsAppNumberId,
      name: g.whatsAppNumberId ? numberName.get(g.whatsAppNumberId) ?? "—" : "Sem número",
      leads: g._count._all,
    }))
    .sort((a, b) => b.leads - a.leads);

  // Por campanha (SENT/FAILED dos OutboundJob no período).
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const byCampaignMap = new Map<string | null, CampaignRow>();
  for (const g of jobGroups) {
    const key = g.campaignId;
    const row =
      byCampaignMap.get(key) ??
      {
        campaignId: key,
        name: key ? campaignName.get(key) ?? "—" : "Sem campanha",
        sent: 0,
        failed: 0,
      };
    if (g.status === "SENT") row.sent += g._count._all;
    else if (g.status === "FAILED") row.failed += g._count._all;
    byCampaignMap.set(key, row);
  }
  const byCampaign = [...byCampaignMap.values()].sort((a, b) => b.sent - a.sent);

  return {
    days,
    totals: {
      leads: totalLeads,
      qualified,
      meetings,
      confirmedMeetings,
      inbound,
      outbound,
    },
    rates: {
      qualifiedRate: ratio(qualified, totalLeads),
      meetingRate: ratio(meetings, qualified),
    },
    funnel,
    newLeadsPerDay,
    byCompany,
    byCampaign,
    sla,
    aiSla,
    resolvedByAgent,
  };
}
