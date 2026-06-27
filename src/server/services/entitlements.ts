import { prisma } from "@/server/db/client";
import { isAdminEmail } from "@/lib/admin";
import { PLAN_LIMITS } from "@/lib/plans";

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
