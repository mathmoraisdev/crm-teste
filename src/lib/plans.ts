import type { Plan } from "@prisma/client";

export interface PlanLimits {
  priceCents: number;
  maxNumbers: number;
  maxSeats: number;   // inclui o admin da conta
  qualify: boolean;   // pode ligar qualifyEnabled por número
  schedule: boolean;  // pode ligar scheduleEnabled por número
  campaigns: boolean; // pode criar/rodar campanha
  aiMonthlyQuota: number;     // pool de créditos de IA/mês na chave da PLATAFORMA (BYOK ignora)
  allowStrongModel: boolean;  // pode usar modelo avançado (strong) na chave da plataforma
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  INICIAL:      { priceCents: 12700, maxNumbers: 1, maxSeats: 2,  qualify: false, schedule: false, campaigns: false, aiMonthlyQuota: 300,  allowStrongModel: false },
  PROFISSIONAL: { priceCents: 24700, maxNumbers: 2, maxSeats: 5,  qualify: true,  schedule: true,  campaigns: true,  aiMonthlyQuota: 1500, allowStrongModel: true  },
  ESCALA:       { priceCents: 49700, maxNumbers: 4, maxSeats: 10, qualify: true,  schedule: true,  campaigns: true,  aiMonthlyQuota: 5000, allowStrongModel: true  },
};

const LABELS: Record<Plan, string> = {
  INICIAL: "Inicial",
  PROFISSIONAL: "Profissional",
  ESCALA: "Escala",
};

export function planLabel(plan: Plan | null): string {
  return plan ? LABELS[plan] : "—";
}
