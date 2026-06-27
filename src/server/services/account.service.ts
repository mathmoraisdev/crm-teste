import { prisma } from "@/server/db/client";
import { isAdminEmail } from "@/lib/admin";
import { accountActive, daysRemaining, addDays, type BillingOverride } from "@/lib/billing";
import type { PaymentMethod } from "@prisma/client";

/**
 * True se a conta dona do lead está ativa (prazo no futuro OU forçada ativa).
 * Fail-safe: lead/conta inexistente → false (preferimos silenciar a IA).
 */
export async function isAccountActiveByLead(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { user: { select: { billingOverride: true, accessUntil: true } } },
  });
  if (!lead?.user) return false;
  return accountActive(lead.user);
}

/** True se a conta (por id do usuário logado) está ativa. Fail-safe: inexistente → false. */
export async function isAccountActive(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { billingOverride: true, accessUntil: true },
  });
  if (!user) return false;
  return accountActive(user);
}

/** Linha de conta para o painel admin (Financeiro). */
export interface AdminAccountRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  billingOverride: BillingOverride;
  accessUntil: Date | null;
  daysLeft: number | null;
  paymentMethod: PaymentMethod | null;
  paymentDueDate: Date | null;
  isAdmin: boolean;
  numbers: number;
  leads: number;
  createdAt: Date;
}

/** Lista todas as contas com status calculado, para o painel Financeiro. */
export async function listAccountsForAdmin(): Promise<AdminAccountRow[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      billingOverride: true,
      accessUntil: true,
      paymentMethod: true,
      paymentDueDate: true,
      createdAt: true,
      _count: { select: { whatsAppNumbers: true, leads: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    active: accountActive(u),
    billingOverride: u.billingOverride as BillingOverride,
    accessUntil: u.accessUntil,
    daysLeft: daysRemaining(u.accessUntil),
    paymentMethod: u.paymentMethod,
    paymentDueDate: u.paymentDueDate,
    isAdmin: isAdminEmail(u.email),
    numbers: u._count.whatsAppNumbers,
    leads: u._count.leads,
    createdAt: u.createdAt,
  }));
}

/** Ação do admin sobre o prazo/override de uma conta. */
export type AccessAction =
  | { kind: "extend"; days: number }              // +N dias a partir de max(prazo, hoje); volta p/ AUTO
  | { kind: "setUntil"; date: Date }              // define a validade exata; volta p/ AUTO
  | { kind: "forceActive" }                       // libera ignorando a data
  | { kind: "forceSuspend" }                      // suspende ignorando a data
  | { kind: "auto" }                              // volta a seguir a data
  | {                                             // anotação: forma de pgto + vencimento (não afeta acesso)
      kind: "setInfo";
      paymentMethod: PaymentMethod | null;
      paymentDueDate: Date | null;
    };

/**
 * Aplica uma ação de acesso. Trava: NUNCA suspende/expira uma conta admin
 * (forceSuspend bloqueado). Devolve `{ id }`.
 */
export async function setAccountAccess(
  userId: string,
  action: AccessAction,
): Promise<{ id: string }> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, accessUntil: true },
  });
  if (!target) throw new Error("Conta não encontrada.");

  const isAdmin = isAdminEmail(target.email);
  if (isAdmin && action.kind === "forceSuspend") {
    throw new Error("Não é possível suspender uma conta admin.");
  }

  let data: {
    billingOverride?: BillingOverride;
    accessUntil?: Date;
    paymentMethod?: PaymentMethod | null;
    paymentDueDate?: Date | null;
  };
  switch (action.kind) {
    case "extend":
      data = { billingOverride: "AUTO", accessUntil: addDays(target.accessUntil, action.days) };
      break;
    case "setUntil":
      data = { billingOverride: "AUTO", accessUntil: action.date };
      break;
    case "forceActive":
      data = { billingOverride: "ACTIVE" };
      break;
    case "forceSuspend":
      data = { billingOverride: "SUSPENDED" };
      break;
    case "auto":
      data = { billingOverride: "AUTO" };
      break;
    case "setInfo":
      // Só anotação: não toca em billingOverride/accessUntil (acesso intacto).
      data = { paymentMethod: action.paymentMethod, paymentDueDate: action.paymentDueDate };
      break;
  }

  await prisma.user.update({ where: { id: userId }, data, select: { id: true } });
  return { id: userId };
}
