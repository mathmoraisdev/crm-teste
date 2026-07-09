import { prisma } from "@/server/db/client";
import { isAdminEmail } from "@/lib/admin";
import { PLAN_LIMITS } from "@/lib/plans";
import { modelCreditWeight } from "@/lib/ai-models";
import { resolveProviderForUser } from "@/server/ai/resolve";

/** Features booleanas da régua de planos (ver PLAN_LIMITS). */
export type PlanFeature = "qualify" | "schedule" | "campaigns" | "sales";

const FEATURE_LABEL: Record<PlanFeature, string> = {
  qualify: "qualificação por IA",
  schedule: "agendamento e lembretes",
  campaigns: "campanhas",
  sales: "funil de vendas com cobrança",
};

/**
 * Garante que o tenant (`userId` = dono) pode usar uma feature do plano.
 *
 * - `plan == null` (grandfather) ou admin da plataforma → sem gate.
 * - Caso contrário, exige `PLAN_LIMITS[plan][feature] === true`.
 */
export async function assertFeature(userId: string, feature: PlanFeature): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true },
  });
  if (!owner) throw new Error("Conta não encontrada");
  if (!owner.plan || isAdminEmail(owner.email)) return; // grandfather / admin
  if (!PLAN_LIMITS[owner.plan][feature]) {
    throw new Error(`Seu plano não inclui ${FEATURE_LABEL[feature]}. Faça upgrade para usar.`);
  }
}

/**
 * Variante booleana de `assertFeature` (não lança) — para gating de UI. Mesma
 * régua: grandfather (plan=null) e admin liberam tudo; senão segue PLAN_LIMITS.
 */
export async function canUseFeature(userId: string, feature: PlanFeature): Promise<boolean> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true },
  });
  if (!owner) return false;
  if (!owner.plan || isAdminEmail(owner.email)) return true;
  return PLAN_LIMITS[owner.plan][feature];
}

/**
 * Pode cobrar online (Pix do cardápio)? Plano com `sales` OU add-on de delivery.
 * Grandfather (plan null) e admin liberam. Espelha a régua de [[pricing-plans-cost]].
 *
 * Diferente de `canUseFeature("sales")`: o add-on de delivery destrava o Pix
 * **escopado ao cardápio** mesmo no plano Inicial (o wedge da pizzaria).
 */
export async function canSellOnline(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, email: true, deliveryAddon: true },
  });
  if (!u) return false;
  if (u.plan == null || isAdminEmail(u.email)) return true;
  if (u.deliveryAddon) return true;
  return PLAN_LIMITS[u.plan].sales === true;
}

/** Chave de mês "YYYY-MM" em UTC — usada pra resetar a cota na virada. */
export function monthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Resultado de consumir 1 crédito de atendimento de IA. */
export type AiQuotaResult =
  | { allowed: true; source: "user" }                              // BYOK: ilimitado
  | { allowed: true; source: "platform"; used: number; quota: number }
  | { allowed: false; used: number; quota: number };               // teto atingido

/**
 * Consome crédito de IA para o tenant (`userId` = dono). Regras:
 *  - BYOK (chave própria do usuário) → ilimitado, não conta nada.
 *  - plano null (grandfather) ou admin da plataforma → ilimitado.
 *  - senão → cobra `peso(model)` créditos contra PLAN_LIMITS[plan].aiMonthlyQuota,
 *    resetando na virada de mês. `model` strong custa mais (STRONG_CREDIT_WEIGHT);
 *    cheap/null custa 1. Retorna { allowed:false } se o peso não couber no que
 *    resta (sem cobrar parcial).
 *
 * `model` = modelo efetivo do atendimento (null = padrão econômico, peso 1).
 * `now` é injetável só p/ teste determinístico (default = agora).
 */
export async function consumeAiCredit(
  userId: string,
  model: string | null = null,
  now: Date = new Date(),
): Promise<AiQuotaResult> {
  // BYOK curto-circuita: quem traz a própria chave paga os próprios créditos.
  const { source } = await resolveProviderForUser(userId);
  if (source === "user") return { allowed: true, source: "user" };

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true, aiCreditMonth: true, aiCreditUsed: true },
  });
  if (!owner) throw new Error("Conta não encontrada");
  if (!owner.plan || isAdminEmail(owner.email)) {
    return { allowed: true, source: "platform", used: 0, quota: Infinity }; // grandfather/admin
  }

  const month = monthKey(now);
  const quota = PLAN_LIMITS[owner.plan].aiMonthlyQuota;
  // Virada de mês zera o contador (reset em tempo real, sem cron).
  const used = owner.aiCreditMonth === month ? owner.aiCreditUsed : 0;
  const weight = modelCreditWeight(model); // strong custa mais

  // Bloqueia se o atendimento neste modelo não cabe no que resta (sem cobrar parcial).
  if (used + weight > quota) return { allowed: false, used, quota };

  const next = used + weight;
  await prisma.user.update({
    where: { id: userId },
    data: { aiCreditMonth: month, aiCreditUsed: next },
  });
  return { allowed: true, source: "platform", used: next, quota };
}

/**
 * Modelo efetivo a usar para o tenant, respeitando o plano/chave:
 *  - BYOK → o modelo pedido, sem clamp (cliente paga a própria chave).
 *  - grandfather (plan=null) / admin → o modelo pedido, sem clamp (ilimitado, qualquer modelo).
 *  - plano comercial na chave da PLATAFORMA → null: ignora o override por número e
 *    deixa o `getAiClient` forçar o econômico. Garante que a nossa chave SÓ roda o
 *    modelo mais barato (não só bloqueia strong — bloqueia qualquer modelo mais caro
 *    que o mini, incluindo variantes cheap-tier como gpt-4.1-mini).
 * `requested` = `aiModel` do número (null = padrão da conta).
 */
export async function resolveAiModelForUser(
  userId: string,
  requested: string | null | undefined,
): Promise<string | null> {
  const req = requested ?? null;
  const { source } = await resolveProviderForUser(userId);
  if (source === "user") return req; // BYOK: sem clamp

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true },
  });
  if (!owner) throw new Error("Conta não encontrada");
  if (!owner.plan || isAdminEmail(owner.email)) return req; // grandfather/admin: qualquer modelo
  return null; // plano comercial na plataforma → sempre o econômico (getAiClient força)
}

export type AiUsageStatus =
  | { unlimited: true; reason: "byok" | "grandfather" | "admin" }
  | { unlimited: false; used: number; quota: number; month: string };

/** Leitura (sem mutação) do consumo de IA do tenant — pra exibir na UI. */
export async function getAiUsageStatus(userId: string, now: Date = new Date()): Promise<AiUsageStatus> {
  const { source } = await resolveProviderForUser(userId);
  if (source === "user") return { unlimited: true, reason: "byok" };

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true, aiCreditMonth: true, aiCreditUsed: true },
  });
  if (!owner) throw new Error("Conta não encontrada");
  if (isAdminEmail(owner.email)) return { unlimited: true, reason: "admin" };
  if (!owner.plan) return { unlimited: true, reason: "grandfather" };

  const month = monthKey(now);
  const used = owner.aiCreditMonth === month ? owner.aiCreditUsed : 0;
  return { unlimited: false, used, quota: PLAN_LIMITS[owner.plan].aiMonthlyQuota, month };
}
