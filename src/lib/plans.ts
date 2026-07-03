import type { Plan } from "@prisma/client";

export interface PlanLimits {
  priceCents: number;
  maxNumbers: number;
  maxSeats: number;   // inclui o admin da conta
  maxContacts: number; // teto de contatos (leads) — gate de criação manual/CSV
  qualify: boolean;   // pode ligar qualifyEnabled por número
  schedule: boolean;  // pode ligar scheduleEnabled por número
  campaigns: boolean; // pode criar/rodar campanha
  sales: boolean;     // pode usar o funil de vendas com cobrança Pix (BYOK de pagamento)
  aiMonthlyQuota: number;     // pool de créditos de IA/mês na chave da PLATAFORMA (BYOK ignora)
  allowStrongModel: boolean;  // pode usar modelo avançado (strong) na chave da plataforma.
                              // Hoje false em TODOS os planos: na chave da plataforma o
                              // atendimento roda sempre no modelo econômico; modelo avançado
                              // só com a própria chave (BYOK). Flag mantido como a alavanca
                              // p/ reabrir strong por plano (recalibrar STRONG_CREDIT_WEIGHT antes).
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  INICIAL:      { priceCents: 9700,  maxNumbers: 1, maxSeats: 2,  maxContacts: 1000,  qualify: false, schedule: false, campaigns: false, sales: false, aiMonthlyQuota: 1200,  allowStrongModel: false },
  PROFISSIONAL: { priceCents: 24700, maxNumbers: 2, maxSeats: 5,  maxContacts: 5000,  qualify: true,  schedule: true,  campaigns: true,  sales: true,  aiMonthlyQuota: 6000,  allowStrongModel: false },
  ESCALA:       { priceCents: 49700, maxNumbers: 4, maxSeats: 10, maxContacts: 25000, qualify: true,  schedule: true,  campaigns: true,  sales: true,  aiMonthlyQuota: 24000, allowStrongModel: false },
};

const LABELS: Record<Plan, string> = {
  INICIAL: "Inicial",
  PROFISSIONAL: "Profissional",
  ESCALA: "Escala",
};

export function planLabel(plan: Plan | null): string {
  return plan ? LABELS[plan] : "—";
}
