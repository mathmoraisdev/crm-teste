import { prisma } from "@/server/db/client";
import type { CashMovementKind, OrderPayment } from "@prisma/client";

export interface CashSessionDTO {
  id: string;
  status: "ABERTA" | "FECHADA";
  openingFloatCents: number;
  closingCountedCents: number | null;
  openedById: string;
  closedById: string | null;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
}

function toDTO(s: {
  id: string; status: "ABERTA" | "FECHADA"; openingFloatCents: number;
  closingCountedCents: number | null; openedById: string; closedById: string | null;
  openedAt: Date; closedAt: Date | null; note: string | null;
}): CashSessionDTO {
  return {
    id: s.id, status: s.status, openingFloatCents: s.openingFloatCents,
    closingCountedCents: s.closingCountedCents, openedById: s.openedById, closedById: s.closedById,
    openedAt: s.openedAt.toISOString(), closedAt: s.closedAt ? s.closedAt.toISOString() : null,
    note: s.note,
  };
}

/** A sessão ABERTA da conta (uma por conta na v1), ou null. É o estado que a barra
 * de caixa consulta. */
export async function getOpenSession(accountId: string): Promise<CashSessionDTO | null> {
  const s = await prisma.cashSession.findFirst({ where: { accountId, status: "ABERTA" } });
  return s ? toDTO(s) : null;
}

/** Uma sessão da conta por id (qualquer status), ou null. Usada pela rota de fechar
 * p/ decidir permissão (fechar a de outro operador exige canSettings). */
export async function getSession(accountId: string, id: string): Promise<CashSessionDTO | null> {
  const s = await prisma.cashSession.findFirst({ where: { id, accountId } });
  return s ? toDTO(s) : null;
}

/** Abre um turno com fundo de troco. Recusa se já há sessão ABERTA na conta
 * (uma por conta — v1). O fundo não pode ser negativo. */
export async function openSession(
  accountId: string,
  openedById: string,
  openingFloatCents: number,
): Promise<CashSessionDTO> {
  if (!Number.isInteger(openingFloatCents) || openingFloatCents < 0) {
    throw new Error("Fundo de troco inválido.");
  }
  const existing = await prisma.cashSession.findFirst({ where: { accountId, status: "ABERTA" } });
  if (existing) throw new Error("Já existe um caixa aberto.");
  const s = await prisma.cashSession.create({
    data: { accountId, openedById, openingFloatCents },
  });
  return toDTO(s);
}

/** Registra um movimento (sangria/suprimento) numa sessão ABERTA da conta.
 * Append-only: nunca edita/apaga. Escopado por conta (a sessão tem de ser da conta). */
export async function addMovement(
  accountId: string,
  sessionId: string,
  kind: CashMovementKind,
  amountCents: number,
  reason: string | null,
  createdById: string,
): Promise<void> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Valor inválido.");
  const session = await prisma.cashSession.findFirst({ where: { id: sessionId, accountId } });
  if (!session) throw new Error("Sessão não encontrada.");
  if (session.status !== "ABERTA") throw new Error("Caixa já fechado.");
  await prisma.cashMovement.create({
    data: { sessionId, kind, amountCents, reason: reason?.trim() || null, createdById },
  });
}

/** Fecha a sessão gravando o valor CONTADO (conferência cega) e o fechador. Só de
 * sessão ABERTA da conta. A diferença esperado×contado é calculada no relatório
 * (sessionSummary), não aqui — o fechamento só carimba o contado. */
export async function closeSession(
  accountId: string,
  sessionId: string,
  closedById: string,
  countedCents: number,
): Promise<CashSessionDTO> {
  if (!Number.isInteger(countedCents) || countedCents < 0) throw new Error("Valor contado inválido.");
  // Guarda atômica: só fecha se ainda ABERTA (updateMany condicionado ao status).
  const res = await prisma.cashSession.updateMany({
    where: { id: sessionId, accountId, status: "ABERTA" },
    data: { status: "FECHADA", closingCountedCents: countedCents, closedById, closedAt: new Date() },
  });
  if (res.count === 0) throw new Error("Sessão não encontrada ou já fechada.");
  const s = await prisma.cashSession.findFirstOrThrow({ where: { id: sessionId, accountId } });
  return toDTO(s);
}

// ── Conferência derivada ───────────────────────────────────────────────────────

export interface ExpectedCashInput {
  openingFloatCents: number;
  cashSalesCents: number;
  suprimentosCents: number;
  sangriasCents: number;
}

/** PURA: esperado em dinheiro na gaveta = fundo + vendas em dinheiro + suprimentos
 * − sangrias. É a fonte da conferência (contado × esperado). */
export function expectedCashCents(i: ExpectedCashInput): number {
  return i.openingFloatCents + i.cashSalesCents + i.suprimentosCents - i.sangriasCents;
}

export type SalesByMethod = Record<OrderPayment, number>;

export interface SessionSummary {
  session: CashSessionDTO;
  cashSalesCents: number; // vendas em DINHEIRO (base da conferência)
  salesByMethod: SalesByMethod; // informativo (cartão/Pix conciliam fora)
  suprimentosCents: number;
  sangriasCents: number;
  expected: number; // esperado em dinheiro (derivado)
  counted: number | null; // contado na conferência cega (null se aberta)
  diff: number | null; // counted − expected (sobra > 0 / falta < 0); null se aberta
}

/** Query: monta a conferência de uma sessão. Vendas por meio vêm de OrderTender das
 * comandas carimbadas com esse cashSessionId (o "vendas em dinheiro" fiel do POS
 * financeiro); movimentos vêm de CashMovement. Chama a pura p/ o esperado. */
export async function sessionSummary(accountId: string, sessionId: string): Promise<SessionSummary> {
  const s = await prisma.cashSession.findFirst({ where: { id: sessionId, accountId } });
  if (!s) throw new Error("Sessão não encontrada.");

  // Vendas por meio: soma OrderTender das comandas desta sessão (escopadas por conta).
  const tenders = await prisma.orderTender.groupBy({
    by: ["method"],
    where: { order: { cashSessionId: sessionId, accountId } },
    _sum: { amountCents: true },
  });
  const salesByMethod: SalesByMethod = { DINHEIRO: 0, PIX: 0, CARTAO: 0, OUTRO: 0 };
  for (const t of tenders) salesByMethod[t.method] = t._sum.amountCents ?? 0;
  const cashSalesCents = salesByMethod.DINHEIRO;

  // Movimentos por tipo.
  const movs = await prisma.cashMovement.groupBy({
    by: ["kind"],
    where: { sessionId },
    _sum: { amountCents: true },
  });
  let suprimentosCents = 0;
  let sangriasCents = 0;
  for (const m of movs) {
    if (m.kind === "SUPRIMENTO") suprimentosCents = m._sum.amountCents ?? 0;
    else if (m.kind === "SANGRIA") sangriasCents = m._sum.amountCents ?? 0;
  }

  const expected = expectedCashCents({
    openingFloatCents: s.openingFloatCents,
    cashSalesCents,
    suprimentosCents,
    sangriasCents,
  });
  const counted = s.closingCountedCents;
  const diff = counted != null ? counted - expected : null;

  return {
    session: toDTO(s), cashSalesCents, salesByMethod, suprimentosCents, sangriasCents,
    expected, counted, diff,
  };
}

/** Sessões FECHADAS da conta (mais recentes primeiro) — base do relatório de sessões. */
export async function listClosedSessions(accountId: string, limit = 30): Promise<CashSessionDTO[]> {
  const rows = await prisma.cashSession.findMany({
    where: { accountId, status: "FECHADA" },
    orderBy: { closedAt: "desc" },
    take: limit,
  });
  return rows.map(toDTO);
}
