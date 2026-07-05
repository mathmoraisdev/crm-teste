import { prisma } from "@/server/db/client";
import { Prisma } from "@prisma/client";
import { orderTotalCents } from "@/server/services/order.service";

/**
 * "Cliente" NÃO é uma entidade nova — é uma LENTE sobre `Lead`. Este serviço vê o
 * lead pelo ângulo do pós-venda: histórico de comandas (`Order`) e total gasto,
 * em vez do funil/atendimento que `lead.service` já cobre. Scoping por `userId`
 * (dono/tenant), igual ao resto do CRM.
 */

export interface ClienteListItem {
  id: string;
  name: string;
  phone: string;
  lastOrderAt: Date | null; // fechamento da comanda mais recente
  totalSpentCents: number; // Σ das comandas FECHADA
  orderCount: number; // nº de comandas FECHADA
}

export interface ListClientesParams {
  assignedToId?: string; // escopo ASSIGNED (operador só vê os seus)
  query?: string; // busca em name/phone (dígitos)
  skip?: number; // default 0
  take?: number; // default 50, cap 100
}

export interface ListClientesResult {
  items: ClienteListItem[];
  total: number;
}

/**
 * Reaproveita a busca por dígitos de telefone já consolidada no CRM: telefone é
 * salvo em E.164 só-dígitos, então casamos por `contains` dos dígitos digitados
 * (com ou sem máscara/DDI). Nome casa por `contains` case-insensitive.
 */
function buildWhere(userId: string, params: ListClientesParams): Prisma.LeadWhereInput {
  return {
    userId,
    ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
    ...(params.query?.trim()
      ? (() => {
          const q = params.query!.trim();
          const digits = q.replace(/\D/g, "");
          const or: Prisma.LeadWhereInput[] = [
            { name: { contains: q, mode: "insensitive" as const } },
          ];
          if (digits.length >= 3) or.push({ phone: { contains: digits } });
          return { OR: or };
        })()
      : {}),
  };
}

/**
 * Lista clientes (= leads) com o agregado de pós-venda: última visita, total gasto
 * e nº de comandas FECHADA. Ordena por última visita (mais recente primeiro),
 * caindo p/ `updatedAt` quando o cliente ainda não comprou nada.
 *
 * A ORDENAÇÃO é feita no banco (raw) por `MAX(Order.closedAt)` das comandas
 * FECHADA — senão a paginação sairia incoerente (fechar comanda NÃO toca
 * `Lead.updatedAt`, então ordenar a página por updatedAt e re-sortear em memória
 * esconderia compradores recentes fora da janela). O raw só decide QUAIS ids e em
 * que ordem; os valores (total gasto/itens) vêm de um `findMany` tipado depois.
 */
export async function listClientes(
  userId: string,
  params: ListClientesParams = {},
): Promise<ListClientesResult> {
  const take = Math.min(Math.max(1, params.take ?? 50), 100);
  const skip = Math.max(0, params.skip ?? 0);

  // Filtros como fragmentos parametrizados (Prisma.sql escapa os valores).
  const conds: Prisma.Sql[] = [Prisma.sql`l."userId" = ${userId}`];
  if (params.assignedToId) conds.push(Prisma.sql`l."assignedToId" = ${params.assignedToId}`);
  const q = params.query?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) {
      conds.push(
        Prisma.sql`(l."name" ILIKE ${"%" + q + "%"} OR l."phone" LIKE ${"%" + digits + "%"})`,
      );
    } else {
      conds.push(Prisma.sql`l."name" ILIKE ${"%" + q + "%"}`);
    }
  }
  const whereSql = Prisma.join(conds, " AND ");

  // ids ordenados por última compra (nulls por último), com desempate por atividade.
  const ordered = await prisma.$queryRaw<{ id: string; total: bigint }[]>(Prisma.sql`
    SELECT l."id" AS id, COUNT(*) OVER () AS total
    FROM "Lead" l
    LEFT JOIN LATERAL (
      SELECT MAX(o."closedAt") AS last_order
      FROM "Order" o
      WHERE o."leadId" = l."id" AND o."status" = 'FECHADA'
    ) lo ON true
    WHERE ${whereSql}
    ORDER BY lo.last_order DESC NULLS LAST, l."updatedAt" DESC
    LIMIT ${take} OFFSET ${skip}
  `);

  const total = ordered.length > 0 ? Number(ordered[0].total) : await prisma.lead.count({ where: buildWhere(userId, params) });
  const ids = ordered.map((r) => r.id);
  if (ids.length === 0) return { items: [], total };

  const rows = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      phone: true,
      orders: {
        where: { status: "FECHADA" },
        select: {
          closedAt: true,
          items: { select: { unitPriceCents: true, quantity: true } },
        },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Preserva a ordem do raw (findMany com `in` não garante ordem).
  const items: ClienteListItem[] = ids.map((id) => {
    const l = byId.get(id)!;
    const totalSpentCents = l.orders.reduce((sum, o) => sum + orderTotalCents(o.items), 0);
    const lastOrderAt = l.orders.reduce<Date | null>((latest, o) => {
      if (!o.closedAt) return latest;
      return !latest || o.closedAt > latest ? o.closedAt : latest;
    }, null);
    return { id: l.id, name: l.name, phone: l.phone, lastOrderAt, totalSpentCents, orderCount: l.orders.length };
  });

  return { items, total };
}

export interface ClienteHistoryOrder {
  id: string;
  status: "ABERTA" | "FECHADA";
  payment: string | null;
  note: string | null;
  createdAt: Date;
  closedAt: Date | null;
  totalCents: number;
  items: { id: string; nameSnapshot: string; unitPriceCents: number; quantity: number }[];
}

export interface ClienteHistory {
  lead: { id: string; name: string; phone: string; email: string | null };
  orders: ClienteHistoryOrder[];
  totalSpentCents: number; // Σ só das FECHADA
  orderCount: number; // nº de FECHADA
}

/**
 * Ficha do cliente: dados básicos do lead + histórico de comandas (abertas e
 * fechadas), mais recente primeiro. Scoping por `userId` — cliente de outro dono
 * não vaza (retorna null quando não pertence à conta).
 */
export async function getClienteHistory(
  userId: string,
  leadId: string,
): Promise<ClienteHistory | null> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, userId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      orders: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          payment: true,
          note: true,
          createdAt: true,
          closedAt: true,
          items: {
            orderBy: { createdAt: "asc" },
            select: { id: true, nameSnapshot: true, unitPriceCents: true, quantity: true },
          },
        },
      },
    },
  });
  if (!lead) return null;

  const orders: ClienteHistoryOrder[] = lead.orders.map((o) => ({
    id: o.id,
    status: o.status,
    payment: o.payment,
    note: o.note,
    createdAt: o.createdAt,
    closedAt: o.closedAt,
    totalCents: orderTotalCents(o.items),
    items: o.items,
  }));

  const closed = orders.filter((o) => o.status === "FECHADA");
  const totalSpentCents = closed.reduce((sum, o) => sum + o.totalCents, 0);

  return {
    lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email },
    orders,
    totalSpentCents,
    orderCount: closed.length,
  };
}
