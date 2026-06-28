import type { Plan } from "@prisma/client";

export interface PlanLimits {
  priceCents: number;
  maxNumbers: number;
  maxSeats: number;   // inclui o admin da conta
  qualify: boolean;   // pode ligar qualifyEnabled por número
  schedule: boolean;  // pode ligar scheduleEnabled por número
  campaigns: boolean; // pode criar/rodar campanha
  aiMonthlyQuota: number; // teto de atendimentos de IA/mês na chave da PLATAFORMA (BYOK ignora)
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  INICIAL:      { priceCents: 12700, maxNumbers: 1, maxSeats: 2,  qualify: false, schedule: false, campaigns: false, aiMonthlyQuota: 300  },
  PROFISSIONAL: { priceCents: 24700, maxNumbers: 2, maxSeats: 5,  qualify: true,  schedule: true,  campaigns: true,  aiMonthlyQuota: 1500 },
  ESCALA:       { priceCents: 49700, maxNumbers: 4, maxSeats: 10, qualify: true,  schedule: true,  campaigns: true,  aiMonthlyQuota: 5000 },
};

const LABELS: Record<Plan, string> = {
  INICIAL: "Inicial",
  PROFISSIONAL: "Profissional",
  ESCALA: "Escala",
};

export function planLabel(plan: Plan | null): string {
  return plan ? LABELS[plan] : "—";
}
