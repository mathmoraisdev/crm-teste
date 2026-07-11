import { prisma } from "@/server/db/client";
import type { AttendanceStatus, LeadStatus } from "@prisma/client";
import { cached } from "@/server/cache/cache";
import { cacheKeys, invalidateLeadCaches } from "@/server/cache/keys";
import { slaState, type SlaState } from "@/lib/inbox/sla";
import { recordAudit } from "@/server/audit/record";

export type InboxFilter = "fila" | "minhas" | "ia" | "todas" | "resolvidas";

/** Estados "ativos" do inbox humano (fora IA e RESOLVIDA) — base de não-lidas/SLA. */
const ACTIVE: AttendanceStatus[] = ["FILA", "ATENDENDO", "AGUARDANDO"];
/** Tudo que não está encerrado — inclui IA, p/ a aba "Todas" monitorar e assumir. */
const NON_RESOLVED: AttendanceStatus[] = ["IA", "FILA", "ATENDENDO", "AGUARDANDO"];

export interface InboxConversation {
  id: string;
  name: string;
  phone: string;
  attendanceStatus: AttendanceStatus;
  // Estágio no funil de vendas — dá contexto de "onde está a venda" no inbox.
  status: LeadStatus;
  assignedTo: { id: string; name: string } | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unread: boolean;
  whatsAppNumber: string | null;
  queuedAt: Date | null;
  firstResponseAt: Date | null;
  // Estado de SLA (reusa queuedAt/firstResponseAt + meta do dono). Calculado no
  // servidor a cada listagem (re-fetch por SSE/polling mantém o destaque fresco).
  sla: SlaState;
  // Trava de atendimento (anti-colisão): quem está com a conversa aberta AGORA
  // (exceto o próprio operador). null = livre. Vem de graça na query da lista.
  attendingBy: { userId: string; name: string; since: Date | null } | null;
  optOut: boolean;
}

export interface InboxCounts {
  fila: number;
  minhas: number;
  ia: number;
  naoLidas: number;
}

/** Número da conta para o seletor do inbox (divisão de conversas por chip). */
export interface InboxNumber {
  id: string;
  label: string;
  displayName: string | null;
}

/** Lista os números (chips/empresas) da conta para o seletor do inbox. */
export async function listAccountNumbers(tenantUserId: string): Promise<InboxNumber[]> {
  return prisma.whatsAppNumber.findMany({
    where: { userId: tenantUserId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, displayName: true },
  });
}

/** Ids válidos de operador da conta: o dono (tenant) + seus membros. */
async function accountOperatorIds(tenantUserId: string): Promise<Set<string>> {
  const members = await prisma.user.findMany({
    where: { ownerId: tenantUserId },
    select: { id: true },
  });
  return new Set([tenantUserId, ...members.map((m) => m.id)]);
}

/** Garante que o lead é da conta; devolve o lead mínimo ou lança. */
async function assertLead(tenantUserId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId: tenantUserId },
    select: { id: true, queuedAt: true, assignedToId: true, name: true },
  });
  if (!lead) throw new Error("Conversa não encontrada.");
  return lead;
}

/**
 * Lista as conversas do inbox conforme o filtro. `unread` compara a última
 * mensagem INBOUND com `lastReadAt` (inbox compartilhado). Ordena por não-lidas
 * primeiro e depois por atividade recente.
 */
export async function listConversations(
  tenantUserId: string,
  opts: { filter?: InboxFilter; sessionUserId: string; whatsAppNumberId?: string },
): Promise<InboxConversation[]> {
  const filter = opts.filter ?? "todas";
  const byStatus =
    filter === "fila"
      ? { userId: tenantUserId, attendanceStatus: "FILA" as AttendanceStatus }
      : filter === "minhas"
        ? {
            userId: tenantUserId,
            assignedToId: opts.sessionUserId,
            attendanceStatus: { in: ["ATENDENDO", "AGUARDANDO"] as AttendanceStatus[] },
          }
        : filter === "ia"
          ? { userId: tenantUserId, attendanceStatus: "IA" as AttendanceStatus }
          : filter === "resolvidas"
            ? { userId: tenantUserId, attendanceStatus: "RESOLVIDA" as AttendanceStatus }
            : { userId: tenantUserId, attendanceStatus: { in: NON_RESOLVED } };
  // Seletor de número: divide as conversas por chip (ex.: cada cartório).
  const where = {
    ...byStatus,
    ...(opts.whatsAppNumberId ? { whatsAppNumberId: opts.whatsAppNumberId } : {}),
  };

  const [leads, owner] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true } },
        attendingTo: { select: { id: true, name: true } },
        whatsAppNumber: { select: { displayName: true, label: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true } },
      },
    }),
    // Meta de SLA é do dono (conta). null = sem meta → slaState nunca marca estouro.
    prisma.user.findUnique({ where: { id: tenantUserId }, select: { inboxSlaMinutes: true } }),
  ]);
  const targetMinutes = owner?.inboxSlaMinutes ?? null;
  const now = new Date();

  // Última INBOUND por lead (uma query) p/ calcular não-lidas.
  const ids = leads.map((l) => l.id);
  const lastInbound =
    ids.length > 0
      ? await prisma.message.groupBy({
          by: ["leadId"],
          where: { leadId: { in: ids }, direction: "INBOUND" },
          _max: { createdAt: true },
        })
      : [];
  const inboundAt = new Map(lastInbound.map((g) => [g.leadId, g._max.createdAt]));

  const rows: InboxConversation[] = leads.map((l) => {
    const lastIn = inboundAt.get(l.id) ?? null;
    const readAt = l.lastReadAt?.getTime() ?? 0;
    return {
      id: l.id,
      name: l.name,
      phone: l.phone,
      attendanceStatus: l.attendanceStatus,
      status: l.status,
      assignedTo: l.assignedTo ? { id: l.assignedTo.id, name: l.assignedTo.name } : null,
      lastMessage: l.messages[0]?.content ?? null,
      lastMessageAt: l.messages[0]?.createdAt ?? null,
      unread: !!lastIn && lastIn.getTime() > readAt,
      whatsAppNumber: l.whatsAppNumber?.displayName?.trim() || l.whatsAppNumber?.label || null,
      queuedAt: l.queuedAt,
      firstResponseAt: l.firstResponseAt,
      sla: slaState({ queuedAt: l.queuedAt, firstResponseAt: l.firstResponseAt, targetMinutes, now }),
      // Trava de atendimento (anti-colisão): quem está com a conversa aberta agora.
      // Vem de graça no include — sem Redis. Não mostra a si mesmo.
      attendingBy:
        l.attendingUserId && l.attendingUserId !== opts.sessionUserId && l.attendingTo
          ? { userId: l.attendingTo.id, name: l.attendingTo.name, since: l.attendingAt }
          : null,
      optOut: l.optOut,
    };
  });

  if (filter === "fila") {
    // Na fila, prioridade é atender o mais antigo primeiro (SLA). Sem queuedAt vai
    // pro fim. Empate desfaz por mensagem mais recente.
    rows.sort((a, b) => {
      const qa = a.queuedAt?.getTime() ?? Infinity;
      const qb = b.queuedAt?.getTime() ?? Infinity;
      if (qa !== qb) return qa - qb;
      return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
    });
  } else {
    // Ordem cronológica pura (última mensagem mais recente no topo), como no WhatsApp.
    // "não-lida" é só destaque visual na lista, não altera a posição.
    rows.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  }
  return rows;
}

/**
 * Atribui a conversa a um operador (default: o próprio). Valida lead da conta e
 * operador da conta. Coloca em ATENDENDO, pausa a IA e marca o início da fila.
 */
export async function assignConversation(
  tenantUserId: string,
  leadId: string,
  operatorId: string,
  actorId: string,
) {
  const lead = await assertLead(tenantUserId, leadId);
  const operators = await accountOperatorIds(tenantUserId);
  if (!operators.has(operatorId)) {
    throw new Error("Operador não pertence a esta conta.");
  }
  const previousAssignee = lead.assignedToId ?? null;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.lead.update({
      where: { id: lead.id },
      data: {
        assignedToId: operatorId,
        attendanceStatus: "ATENDENDO",
        aiPaused: true,
        aiPausedAt: new Date(),
        ...(lead.queuedAt ? {} : { queuedAt: new Date() }),
      },
    });
    // Só audita se o DESTINO mudou de fato (reassumir p/ o mesmo não é reatribuição).
    if (previousAssignee !== operatorId) {
      await recordAudit(tx, {
        accountId: tenantUserId, actorId, action: "LEAD_REASSIGN", entityType: "Lead", entityId: lead.id,
        summary: `Reatribuiu o cliente "${lead.name ?? lead.id}"`,
        diff: { assignedToId: { from: previousAssignee, to: operatorId } },
      });
    }
    return u;
  });
  await invalidateLeadCaches(tenantUserId); // contadores de inbox mudaram
  return updated;
}

/** Coloca a conversa na FILA (handoff sem atribuição). Pausa a IA. */
export async function enqueueConversation(tenantUserId: string, leadId: string) {
  const lead = await assertLead(tenantUserId, leadId);
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      attendanceStatus: "FILA",
      aiPaused: true,
      aiPausedAt: new Date(),
      ...(lead.queuedAt ? {} : { queuedAt: new Date() }),
    },
  });
  await invalidateLeadCaches(tenantUserId);
  return updated;
}

/** Encerra a conversa. Por padrão devolve o controle à IA. */
export async function resolveConversation(
  tenantUserId: string,
  leadId: string,
  opts: { returnToAi?: boolean } = {},
) {
  const lead = await assertLead(tenantUserId, leadId);
  const returnToAi = opts.returnToAi ?? true;
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      attendanceStatus: "RESOLVIDA",
      // Devolver à IA também sinaliza o worker p/ responder a backlog pendente
      // (mesma semântica do setHandoff), sem esperar novo inbound do lead.
      ...(returnToAi ? { aiPaused: false, aiPausedAt: null, aiResumePendingAt: new Date() } : {}),
    },
  });
  await invalidateLeadCaches(tenantUserId);
  return updated;
}

/** Marca a conversa como lida (inbox compartilhado). */
export async function markRead(tenantUserId: string, leadId: string) {
  const lead = await assertLead(tenantUserId, leadId);
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { lastReadAt: new Date() },
  });
  await invalidateLeadCaches(tenantUserId); // não-lidas mudou
  return updated;
}

/** Contadores p/ badges: fila, minhas (do operador) e não-lidas (ativas). */
export async function inboxCounts(
  tenantUserId: string,
  sessionUserId: string,
  whatsAppNumberId?: string,
): Promise<InboxCounts> {
  // Cache curto (30s): badges toleram alguns segundos de atraso e a contagem é
  // cara (vários count + groupBy de não-lidas). Chave por (conta, operador,
  // número) porque "minhas" é por operador e o seletor filtra por chip. Invalida
  // nas escritas (invalidateLeadCaches varre o prefixo da conta).
  return cached(cacheKeys.inboxCounts(tenantUserId, sessionUserId, whatsAppNumberId), 30, () =>
    computeInboxCounts(tenantUserId, sessionUserId, whatsAppNumberId),
  );
}

async function computeInboxCounts(
  tenantUserId: string,
  sessionUserId: string,
  whatsAppNumberId?: string,
): Promise<InboxCounts> {
  const num = whatsAppNumberId ? { whatsAppNumberId } : {};
  const [fila, minhas, ia, active] = await Promise.all([
    prisma.lead.count({ where: { userId: tenantUserId, attendanceStatus: "FILA", ...num } }),
    prisma.lead.count({
      where: {
        userId: tenantUserId,
        assignedToId: sessionUserId,
        attendanceStatus: { in: ["ATENDENDO", "AGUARDANDO"] },
        ...num,
      },
    }),
    prisma.lead.count({ where: { userId: tenantUserId, attendanceStatus: "IA", ...num } }),
    prisma.lead.findMany({
      where: { userId: tenantUserId, attendanceStatus: { in: ACTIVE }, ...num },
      select: { id: true, lastReadAt: true },
    }),
  ]);

  let naoLidas = 0;
  if (active.length > 0) {
    const ids = active.map((l) => l.id);
    const lastInbound = await prisma.message.groupBy({
      by: ["leadId"],
      where: { leadId: { in: ids }, direction: "INBOUND" },
      _max: { createdAt: true },
    });
    const inboundAt = new Map(lastInbound.map((g) => [g.leadId, g._max.createdAt]));
    for (const l of active) {
      const lastIn = inboundAt.get(l.id);
      if (lastIn && lastIn.getTime() > (l.lastReadAt?.getTime() ?? 0)) naoLidas++;
    }
  }

  return { fila, minhas, ia, naoLidas };
}
