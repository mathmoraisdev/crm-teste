import { prisma } from "@/server/db/client";
import type { AttendanceStatus } from "@prisma/client";

export type InboxFilter = "fila" | "minhas" | "todas" | "resolvidas";

/** Estados "ativos" do inbox (fora IA e RESOLVIDA). */
const ACTIVE: AttendanceStatus[] = ["FILA", "ATENDENDO", "AGUARDANDO"];

export interface InboxConversation {
  id: string;
  name: string;
  phone: string;
  attendanceStatus: AttendanceStatus;
  assignedTo: { id: string; name: string } | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unread: boolean;
  whatsAppNumber: string | null;
  queuedAt: Date | null;
}

export interface InboxCounts {
  fila: number;
  minhas: number;
  naoLidas: number;
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
    select: { id: true, queuedAt: true },
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
  opts: { filter?: InboxFilter; sessionUserId: string },
): Promise<InboxConversation[]> {
  const filter = opts.filter ?? "todas";
  const where =
    filter === "fila"
      ? { userId: tenantUserId, attendanceStatus: "FILA" as AttendanceStatus }
      : filter === "minhas"
        ? {
            userId: tenantUserId,
            assignedToId: opts.sessionUserId,
            attendanceStatus: { in: ["ATENDENDO", "AGUARDANDO"] as AttendanceStatus[] },
          }
        : filter === "resolvidas"
          ? { userId: tenantUserId, attendanceStatus: "RESOLVIDA" as AttendanceStatus }
          : { userId: tenantUserId, attendanceStatus: { in: ACTIVE } };

  const leads = await prisma.lead.findMany({
    where,
    include: {
      assignedTo: { select: { id: true, name: true } },
      whatsAppNumber: { select: { displayName: true, label: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true } },
    },
  });

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
      assignedTo: l.assignedTo ? { id: l.assignedTo.id, name: l.assignedTo.name } : null,
      lastMessage: l.messages[0]?.content ?? null,
      lastMessageAt: l.messages[0]?.createdAt ?? null,
      unread: !!lastIn && lastIn.getTime() > readAt,
      whatsAppNumber: l.whatsAppNumber?.displayName?.trim() || l.whatsAppNumber?.label || null,
      queuedAt: l.queuedAt,
    };
  });

  rows.sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
  });
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
) {
  const lead = await assertLead(tenantUserId, leadId);
  const operators = await accountOperatorIds(tenantUserId);
  if (!operators.has(operatorId)) {
    throw new Error("Operador não pertence a esta conta.");
  }
  return prisma.lead.update({
    where: { id: lead.id },
    data: {
      assignedToId: operatorId,
      attendanceStatus: "ATENDENDO",
      aiPaused: true,
      aiPausedAt: new Date(),
      ...(lead.queuedAt ? {} : { queuedAt: new Date() }),
    },
  });
}

/** Coloca a conversa na FILA (handoff sem atribuição). Pausa a IA. */
export async function enqueueConversation(tenantUserId: string, leadId: string) {
  const lead = await assertLead(tenantUserId, leadId);
  return prisma.lead.update({
    where: { id: lead.id },
    data: {
      attendanceStatus: "FILA",
      aiPaused: true,
      aiPausedAt: new Date(),
      ...(lead.queuedAt ? {} : { queuedAt: new Date() }),
    },
  });
}

/** Encerra a conversa. Por padrão devolve o controle à IA. */
export async function resolveConversation(
  tenantUserId: string,
  leadId: string,
  opts: { returnToAi?: boolean } = {},
) {
  const lead = await assertLead(tenantUserId, leadId);
  const returnToAi = opts.returnToAi ?? true;
  return prisma.lead.update({
    where: { id: lead.id },
    data: {
      attendanceStatus: "RESOLVIDA",
      ...(returnToAi ? { aiPaused: false, aiPausedAt: null } : {}),
    },
  });
}

/** Marca a conversa como lida (inbox compartilhado). */
export async function markRead(tenantUserId: string, leadId: string) {
  const lead = await assertLead(tenantUserId, leadId);
  return prisma.lead.update({
    where: { id: lead.id },
    data: { lastReadAt: new Date() },
  });
}

/** Contadores p/ badges: fila, minhas (do operador) e não-lidas (ativas). */
export async function inboxCounts(
  tenantUserId: string,
  sessionUserId: string,
): Promise<InboxCounts> {
  const [fila, minhas, active] = await Promise.all([
    prisma.lead.count({ where: { userId: tenantUserId, attendanceStatus: "FILA" } }),
    prisma.lead.count({
      where: {
        userId: tenantUserId,
        assignedToId: sessionUserId,
        attendanceStatus: { in: ["ATENDENDO", "AGUARDANDO"] },
      },
    }),
    prisma.lead.findMany({
      where: { userId: tenantUserId, attendanceStatus: { in: ACTIVE } },
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

  return { fila, minhas, naoLidas };
}
