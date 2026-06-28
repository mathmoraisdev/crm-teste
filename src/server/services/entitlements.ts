import { prisma } from "@/server/db/client";
import { isAdminEmail } from "@/lib/admin";
import { PLAN_LIMITS } from "@/lib/plans";
import { resolveProviderForUser } from "@/server/ai/resolve";

/** Features booleanas da régua de planos (ver PLAN_LIMITS). */
export type PlanFeature = "qualify" | "schedule" | "campaigns";

const FEATURE_LABEL: Record<PlanFeature, string> = {
  qualify: "qualificação por IA",
  schedule: "agendamento e lembretes",
  campaigns: "campanhas",
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
 * Consome 1 crédito de IA para o tenant (`userId` = dono). Regras:
 *  - BYOK (chave própria do usuário) → ilimitado, não conta nada.
 *  - plano null (grandfather) ou admin da plataforma → ilimitado.
 *  - senão → conta contra PLAN_LIMITS[plan].aiMonthlyQuota, resetando na virada
 *    de mês. Retorna { allowed:false } se já estourou (sem incrementar).
 *
 * `now` é injetável só p/ teste determinístico (default = agora).
 */
export async function consumeAiCredit(userId: string, now: Date = new Date()): Promise<AiQuotaResult> {
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

  if (used >= quota) return { allowed: false, used, quota };

  const next = used + 1;
  await prisma.user.update({
    where: { id: userId },
    data: { aiCreditMonth: month, aiCreditUsed: next },
  });
  return { allowed: true, source: "platform", used: next, quota };
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
