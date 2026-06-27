import { prisma } from "@/server/db/client";
import { PLAN_LIMITS } from "@/lib/plans";
// Nota: NÃO importar `Plan` do @prisma/client aqui — `PLAN_LIMITS` já é
// `Record<Plan, ...>` e o narrowing `plan ? PLAN_LIMITS[plan] : null` basta.

export type OnboardingStepKey =
  | "number" | "leads" | "ai" | "campaign" | "meeting";

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
}

export interface OnboardingState {
  steps: OnboardingStep[]; // só os passos aplicáveis ao plano
  completed: number;       // quantos done
  total: number;           // steps.length
  done: boolean;           // completed === total → esconde o card
}

/**
 * Estado do onboarding in-app, ciente do plano do dono da conta. O conjunto de
 * passos depende de `PLAN_LIMITS[plan]`: features gateadas (IA/qualificação,
 * agenda) só aparecem para quem as contratou — senão o contador "X de N" ficaria
 * mentiroso. Plano `null` (legado/admin) libera o subconjunto seguro (número +
 * leads + campanha) sem travar nada. Tudo escopado por `userId` (multitenant);
 * o caller passa `getTenantUserId()` (= o dono), onde `plan`/`aiProvider` vivem.
 */
export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const [user, numbers, leads, campaigns, meetings] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true, aiProvider: true } }),
    prisma.whatsAppNumber.count({ where: { userId } }),
    prisma.lead.count({ where: { userId } }),
    prisma.campaign.count({ where: { userId } }),
    prisma.meeting.count({ where: { lead: { userId } } }),
  ]);

  const plan = user?.plan ?? null;
  const limits = plan ? PLAN_LIMITS[plan] : null;

  // Plano null (legado/admin) libera o subconjunto seguro; com plano, respeita o gating.
  const showAi = limits?.qualify ?? false;
  const showCampaign = limits?.campaigns ?? true;
  const showMeeting = limits?.schedule ?? false;

  const all: Array<OnboardingStep & { show: boolean }> = [
    { key: "number",   done: numbers > 0,        show: true },
    { key: "leads",    done: leads > 0,          show: true },
    { key: "ai",       done: !!user?.aiProvider, show: showAi },
    { key: "campaign", done: campaigns > 0,      show: showCampaign },
    { key: "meeting",  done: meetings > 0,       show: showMeeting },
  ];

  const steps = all.filter((s) => s.show).map(({ key, done }) => ({ key, done }));
  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, total: steps.length, done: completed === steps.length };
}
