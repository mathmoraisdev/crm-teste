import { prisma } from "@/server/db/client";

export interface OnboardingState {
  hasNumber: boolean; // já conectou ao menos um chip WhatsApp
  hasLeads: boolean; // já importou/criou ao menos um lead
  hasCampaign: boolean; // já criou ao menos uma campanha
  done: boolean; // os 3 passos concluídos — esconde o checklist
}

/**
 * Estado do onboarding in-app a partir de contagens simples por conta.
 * Guia o novo usuário pelos 3 primeiros passos: conectar WhatsApp, importar
 * leads e criar a primeira campanha. Tudo escopado por `userId` (multitenant).
 */
export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const [numbers, leads, campaigns] = await Promise.all([
    prisma.whatsAppNumber.count({ where: { userId } }),
    prisma.lead.count({ where: { userId } }),
    prisma.campaign.count({ where: { userId } }),
  ]);
  const hasNumber = numbers > 0;
  const hasLeads = leads > 0;
  const hasCampaign = campaigns > 0;
  return {
    hasNumber,
    hasLeads,
    hasCampaign,
    done: hasNumber && hasLeads && hasCampaign,
  };
}
