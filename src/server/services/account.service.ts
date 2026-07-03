import { prisma } from "@/server/db/client";
import { isAdminEmail } from "@/lib/admin";
import { accountActive, daysRemaining, addDays, type BillingOverride } from "@/lib/billing";
import { PLAN_LIMITS } from "@/lib/plans";
import type { AccountRole, LeadStatus, PaymentMethod, Plan } from "@prisma/client";
import { PIPELINE_ORDER, type PipelineLabels } from "@/lib/leadStatus";
import { getAiUsageStatus } from "@/server/services/entitlements";
import { contactCapacity } from "@/server/services/lead.service";

/** Lê os rótulos renomeados das etapas do funil da conta (ou {} se não houver). */
export async function getPipelineLabels(userId: string): Promise<PipelineLabels> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { pipelineLabels: true },
  });
  const raw = u?.pipelineLabels;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as PipelineLabels;
  }
  return {};
}

/**
 * Grava os rótulos renomeados. Só aceita chaves de `LeadStatus`; rótulo vazio
 * remove o override (volta ao default). O enum NUNCA muda.
 */
export async function setPipelineLabels(
  userId: string,
  labels: Record<string, unknown>,
): Promise<PipelineLabels> {
  const valid = new Set<string>(PIPELINE_ORDER);
  const clean: PipelineLabels = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!valid.has(key)) continue;
    if (typeof value === "string" && value.trim()) {
      clean[key as LeadStatus] = value.trim();
    }
  }
  await prisma.user.update({
    where: { id: userId },
    data: { pipelineLabels: clean },
    select: { id: true },
  });
  return clean;
}

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

/** Um assento (seat) da conta: o próprio dono (ADMIN) ou um operador. */
export interface AccountSeat {
  id: string;
  name: string;
  email: string;
  role: AccountRole;  // ADMIN = dono da conta; OPERADOR = operador
  isOwner: boolean;   // true só no dono (tenant)
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
  plan: Plan | null;
  isAdmin: boolean;
  numbers: number;
  leads: number;
  seatsUsed: number;         // dono + operadores
  maxSeats: number | null;   // teto do plano (null = sem plano definido)
  seats: AccountSeat[];      // dono (primeiro) + operadores, p/ o dropdown de usuários
  createdAt: Date;
  // Cota de IA na chave da plataforma (BYOK = ilimitado).
  byok: boolean;             // true = conta usa chave própria → consumo ilimitado
  aiCreditMonth: string | null;
  aiCreditUsed: number;
}

/**
 * Lista as contas faturáveis (só DONOS: `ownerId = null`) com status calculado,
 * para o painel Financeiro. Operadores não são contas faturáveis — não aparecem.
 */
export async function listAccountsForAdmin(): Promise<AdminAccountRow[]> {
  const users = await prisma.user.findMany({
    where: { ownerId: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      billingOverride: true,
      accessUntil: true,
      paymentMethod: true,
      paymentDueDate: true,
      plan: true,
      createdAt: true,
      aiProvider: true,
      aiKeyEnc: true,
      aiCreditMonth: true,
      aiCreditUsed: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, role: true },
      },
      _count: { select: { whatsAppNumbers: true, leads: true, members: true } },
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
    plan: u.plan,
    isAdmin: isAdminEmail(u.email),
    numbers: u._count.whatsAppNumbers,
    leads: u._count.leads,
    seatsUsed: 1 + u._count.members, // o próprio dono + operadores
    maxSeats: u.plan ? PLAN_LIMITS[u.plan].maxSeats : null,
    // Dono primeiro (é o ADMIN da conta), depois os operadores.
    seats: [
      { id: u.id, name: u.name, email: u.email, role: u.role, isOwner: true },
      ...u.members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        isOwner: false,
      })),
    ],
    createdAt: u.createdAt,
    // BYOK exige provider + chave cifrada (igual resolveProviderForUser).
    byok: !!(u.aiProvider && u.aiKeyEnc),
    aiCreditMonth: u.aiCreditMonth,
    aiCreditUsed: u.aiCreditUsed,
  }));
}

/** Uso vs. teto do plano de UMA conta (tenant) — alimenta o card do dashboard. */
export interface AccountLimits {
  plan: Plan | null;
  byok: boolean;
  ai: { unlimited: boolean; used: number; quota: number };
  contacts: { unlimited: boolean; used: number; max: number };
  numbers: { unlimited: boolean; used: number; max: number };
  seats: { unlimited: boolean; used: number; max: number };
}

/**
 * Uso vs. teto do plano p/ a conta. IA reusa a leitura do gate (BYOK/admin/
 * grandfather = ilimitado). Contatos/números/seats: ilimitado p/ admin ou conta
 * sem plano; senão o teto de PLAN_LIMITS. Serve admin e operador (é a conta).
 */
export async function getAccountLimits(userId: string): Promise<AccountLimits> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true, plan: true, aiProvider: true, aiKeyEnc: true,
      _count: { select: { whatsAppNumbers: true, leads: true, members: true } },
    },
  });
  if (!owner) throw new Error("Conta não encontrada");
  const noCap = isAdminEmail(owner.email) || !owner.plan; // admin/grandfather: sem teto
  const lim = owner.plan ? PLAN_LIMITS[owner.plan] : null;

  const [ai, contacts] = await Promise.all([getAiUsageStatus(userId), contactCapacity(userId)]);

  return {
    plan: owner.plan,
    byok: !!(owner.aiProvider && owner.aiKeyEnc),
    ai: ai.unlimited
      ? { unlimited: true, used: 0, quota: 0 }
      : { unlimited: false, used: ai.used, quota: ai.quota },
    contacts: contacts.unlimited
      ? { unlimited: true, used: owner._count.leads, max: 0 }
      : { unlimited: false, used: contacts.used, max: contacts.max },
    numbers: noCap
      ? { unlimited: true, used: owner._count.whatsAppNumbers, max: 0 }
      : { unlimited: false, used: owner._count.whatsAppNumbers, max: lim!.maxNumbers },
    seats: noCap
      ? { unlimited: true, used: 1 + owner._count.members, max: 0 }
      : { unlimited: false, used: 1 + owner._count.members, max: lim!.maxSeats },
  };
}

/** Ação do admin sobre o prazo/override de uma conta. */
export type AccessAction =
  | { kind: "trial"; days: number }               // teste: acesso = HOJE + N (hard reset, não soma) + limpa pagamento; AUTO
  | { kind: "extend"; days: number }              // +N dias a partir de max(prazo, hoje); volta p/ AUTO
  | { kind: "setUntil"; date: Date }              // define a validade exata; volta p/ AUTO
  | { kind: "forceActive" }                       // libera ignorando a data
  | { kind: "forceSuspend" }                      // suspende ignorando a data
  | { kind: "auto" }                              // volta a seguir a data
  | { kind: "clearPayment" }                      // remove a marcação de pagamento e RECALCULA o acesso pelos pgtos restantes
  | {                                             // lança pagamento: forma + vencimento; vencimento LIBERA acesso até a data
      kind: "setInfo";
      paymentMethod: PaymentMethod | null;
      paymentDueDate: Date | null;
      amountCents: number | null; // null/0 = não registra receita; >0 = cria Payment
    }
  | { kind: "setPlan"; plan: Plan | null }; // rótulo comercial; não toca em acesso/override

/**
 * Aplica uma ação de acesso. Trava: NUNCA suspende/expira uma conta admin
 * (forceSuspend bloqueado). Devolve `{ id }`.
 */
export async function setAccountAccess(
  userId: string,
  action: AccessAction,
  registeredById?: string | null, // admin que lançou (gravado no Payment; null = desconhecido)
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
    plan?: Plan | null;
  };
  switch (action.kind) {
    case "setPlan":
      // Só o rótulo. Não mexe em billingOverride/accessUntil de propósito.
      data = { plan: action.plan };
      break;
    case "trial":
      // Teste: prazo = HOJE + N, sem somar sobre o vigente (hard reset). Limpa a
      // marcação de pagamento — trial ≠ pago (e `paymentDueDate=null` faz a conta
      // voltar a respeitar o teto de disparo do trial). `addDays(null, n)` = now + n.
      data = {
        billingOverride: "AUTO",
        accessUntil: addDays(null, action.days),
        paymentMethod: null,
        paymentDueDate: null,
      };
      break;
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
    case "setInfo": {
      // Lançar pagamento: registra forma + vencimento. Quando HÁ vencimento, ele
      // também LIBERA o acesso — a conta funciona (AUTO) até a data do vencimento.
      // Sem vencimento = só anotação (não mexe no acesso).
      const infoData: typeof data = {
        paymentMethod: action.paymentMethod,
        paymentDueDate: action.paymentDueDate,
      };
      if (action.paymentDueDate) {
        infoData.billingOverride = "AUTO";
        infoData.accessUntil = action.paymentDueDate;
      }
      // Com valor: grava o update E o Payment atomicamente (ledger não diverge do acesso).
      if (action.amountCents && action.amountCents > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: userId }, data: infoData, select: { id: true } });
          await tx.payment.create({
            data: {
              accountId: userId,
              amountCents: action.amountCents!,
              method: action.paymentMethod,
              coversUntil: action.paymentDueDate, // snapshot do prazo que este pgto cobriu
              registeredById: registeredById ?? null, // quem lançou (admin logado)
            },
          });
        });
        return { id: userId };
      }
      // Sem valor: comportamento de hoje, só o update.
      await prisma.user.update({ where: { id: userId }, data: infoData, select: { id: true } });
      return { id: userId };
    }
    case "clearPayment": {
      // Remover lançamento: zera a anotação (forma/vencimento) E recalcula o acesso
      // a partir do pagamento restante mais recente (snapshot em `coversUntil`). Sem
      // pagamento sobrando → accessUntil = null (AUTO + null = suspenso). Não força
      // override: respeita ACTIVE/SUSPENDED manual; só corrige a DATA derivada do pgto.
      const lastPaid = await prisma.payment.findFirst({
        where: { accountId: userId, coversUntil: { not: null } },
        orderBy: { coversUntil: "desc" },
        select: { coversUntil: true },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { paymentMethod: null, paymentDueDate: null, accessUntil: lastPaid?.coversUntil ?? null },
        select: { id: true },
      });
      return { id: userId };
    }
  }

  await prisma.user.update({ where: { id: userId }, data, select: { id: true } });
  return { id: userId };
}
