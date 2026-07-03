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

/** Ponto diário do gráfico de atividade: recebidas x respondidas pela IA. */
export interface ActivityPoint {
  day: string; // YYYY-MM-DD
  received: number; // INBOUND do lead no dia
  aiReplied: number; // OUTBOUND source=AI no dia
}

export interface UpcomingMeeting {
  id: string;
  leadId: string;
  leadName: string;
  scheduledAt: string; // ISO
  status: string;
}

export interface DashboardData {
  days: number;
  rangeStart: string; // ISO — início do intervalo aplicado
  rangeEnd: string; // ISO — fim do intervalo aplicado
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
  // Série diária p/ o gráfico de tendência (recebidas x respondidas pela IA).
  activityPerDay: ActivityPoint[];
  // Automação: quanto das mensagens recebidas a IA respondeu no período.
  automation: { received: number; aiReplied: number; rate: number };
  // Próximos compromissos (dashboard puxa da agenda p/ visão do dia).
  upcomingMeetings: UpcomingMeeting[];
  // Variação % vs o período imediatamente anterior (null quando não há base).
  deltas: { leads: number | null; inbound: number | null; confirmedMeetings: number | null };
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

/** Variação percentual vs período anterior. null quando não há base (prev=0). */
function deltaPct(cur: number, prev: number): number | null {
  return prev > 0 ? (cur - prev) / prev : null;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Métricas do painel da conta num intervalo. Aceita presets (`days`, default 30)
 * OU um intervalo explícito (`from`/`to`). TODO o painel — inclusive funil e
 * cartões de topo — é escopado por `Lead.createdAt` dentro da janela. Usa
 * groupBy/count (sem N+1). Taxas nunca dividem por zero.
 */
export async function getDashboard(
  userId: string,
  opts: { days?: number; from?: Date; to?: Date } = {},
): Promise<DashboardData> {
  // Janela: `from`/`to` explícitos têm precedência; senão, `days` a partir de agora.
  const until = opts.to ?? new Date();
  const rawSince = opts.from ?? new Date(until.getTime() - Math.max(1, Math.min(365, opts.days ?? 30)) * 86_400_000);
  // Protege o bucket diário: no máx. 366 dias de span.
  const spanDays = Math.max(1, Math.min(366, Math.ceil((until.getTime() - rawSince.getTime()) / 86_400_000)));
  const since = rawSince;
  const days = spanDays;
  // Janela reutilizada em todas as queries por período (createdAt).
  const window = { gte: since, lte: until };

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
    prisma.lead.groupBy({ by: ["status"], where: { userId, createdAt: window }, _count: { _all: true } }),
    prisma.message.groupBy({
      by: ["direction"],
      where: { lead: { userId }, createdAt: window },
      _count: { _all: true },
    }),
    prisma.lead.findMany({
      where: { userId, createdAt: window },
      select: { createdAt: true },
    }),
    prisma.lead.groupBy({ by: ["whatsAppNumberId"], where: { userId, createdAt: window }, _count: { _all: true } }),
    prisma.whatsAppNumber.findMany({
      where: { userId },
      select: { id: true, label: true, displayName: true },
    }),
    prisma.outboundJob.groupBy({
      by: ["campaignId", "status"],
      where: { lead: { userId }, createdAt: window },
      _count: { _all: true },
    }),
    prisma.campaign.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.meeting.count({
      where: { lead: { userId }, status: "CONFIRMED", scheduledAt: window },
    }),
  ]);

  // SLA de 1ª resposta humana + resolvidas por atendente + mensagens p/ o SLA da IA.
  const [slaLeads, resolvedGroups, members, aiSlaMessages] = await Promise.all([
    prisma.lead.findMany({
      where: { userId, queuedAt: { not: null }, firstResponseAt: { not: null, ...window } },
      select: { queuedAt: true, firstResponseAt: true },
    }),
    prisma.lead.groupBy({
      by: ["assignedToId"],
      where: { userId, attendanceStatus: "RESOLVIDA", firstResponseAt: window },
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
        createdAt: window,
        OR: [{ direction: "INBOUND" }, { direction: "OUTBOUND", source: "AI" }],
      },
      select: { leadId: true, direction: true, createdAt: true },
      orderBy: [{ leadId: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  // Período ANTERIOR (mesma duração, imediatamente antes) p/ os deltas, e os
  // próximos compromissos (independem da janela — são "de agora pra frente").
  const now = new Date();
  const prevWindow = { gte: new Date(since.getTime() - days * 86_400_000), lt: since };
  const [prevLeads, prevInbound, prevConfirmedMeetings, upcoming] = await Promise.all([
    prisma.lead.count({ where: { userId, createdAt: prevWindow } }),
    prisma.message.count({
      where: { lead: { userId }, direction: "INBOUND", createdAt: prevWindow },
    }),
    prisma.meeting.count({
      where: { lead: { userId }, status: "CONFIRMED", scheduledAt: prevWindow },
    }),
    prisma.meeting.findMany({
      where: {
        lead: { userId },
        status: { in: ["CONFIRMED", "PROPOSED"] },
        scheduledAt: { gte: now },
      },
      select: { id: true, scheduledAt: true, status: true, lead: { select: { id: true, name: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 5,
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

  // Série diária recebidas x respondidas pela IA (a partir das mensagens já
  // buscadas p/ o SLA da IA — inbound do lead + outbound source=AI).
  const actMap = new Map<string, { received: number; aiReplied: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    actMap.set(dayKey(d), { received: 0, aiReplied: 0 });
  }
  for (const m of aiSlaMessages) {
    const slot = actMap.get(dayKey(m.createdAt));
    if (!slot) continue;
    if (m.direction === "INBOUND") slot.received += 1;
    else slot.aiReplied += 1; // OUTBOUND source=AI (filtro da query)
  }
  const activityPerDay: ActivityPoint[] = [...actMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, received: v.received, aiReplied: v.aiReplied }));

  const aiRepliedTotal = activityPerDay.reduce((s, p) => s + p.aiReplied, 0);
  const receivedTotal = activityPerDay.reduce((s, p) => s + p.received, 0);
  const automation = {
    received: receivedTotal,
    aiReplied: aiRepliedTotal,
    rate: ratio(aiRepliedTotal, receivedTotal),
  };

  const deltas = {
    leads: deltaPct(totalLeads, prevLeads),
    inbound: deltaPct(inbound, prevInbound),
    confirmedMeetings: deltaPct(confirmedMeetings, prevConfirmedMeetings),
  };

  const upcomingMeetings: UpcomingMeeting[] = upcoming
    .filter((m) => m.scheduledAt)
    .map((m) => ({
      id: m.id,
      leadId: m.lead.id,
      leadName: m.lead.name,
      scheduledAt: m.scheduledAt!.toISOString(),
      status: m.status,
    }));

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
    rangeStart: since.toISOString(),
    rangeEnd: until.toISOString(),
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
    activityPerDay,
    automation,
    upcomingMeetings,
    deltas,
    byCompany,
    byCampaign,
    sla,
    aiSla,
    resolvedByAgent,
  };
}
