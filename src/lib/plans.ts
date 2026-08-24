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

// Preços e tetos recalibrados (2026-08): cotas de IA comprimidas de propósito
// p/ conter custo de infra/IA — Profissional fica apertado (2.500) p/ empurrar
// alto volume ao Escala (até 8.000). Manter priceCents em sync com o
// `priceMonthly` do PLANS em components/marketing/Landing.tsx. Ver [[pricing-plans-cost]].
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  INICIAL:      { priceCents: 19700, maxNumbers: 1, maxSeats: 1,  maxContacts: 300,   qualify: false, schedule: false, campaigns: false, sales: false, aiMonthlyQuota: 1000, allowStrongModel: false },
  PROFISSIONAL: { priceCents: 49700, maxNumbers: 2, maxSeats: 2,  maxContacts: 2000,  qualify: true,  schedule: true,  campaigns: true,  sales: true,  aiMonthlyQuota: 2500, allowStrongModel: false },
  ESCALA:       { priceCents: 89900, maxNumbers: 4, maxSeats: 10, maxContacts: 25000, qualify: true,  schedule: true,  campaigns: true,  sales: true,  aiMonthlyQuota: 8000, allowStrongModel: false },
};

/**
 * Add-on de Delivery/Cardápio online — cobrado à parte, EM CIMA de qualquer plano
 * (não vem incluso no Profissional+). Acende só p/ quem vende com entrega; gate em
 * `canUseDelivery`. Ver [[pricing-plans-cost]].
 */
export const DELIVERY_ADDON_PRICE_CENTS = 8900;

const LABELS: Record<Plan, string> = {
  INICIAL: "Inicial",
  PROFISSIONAL: "Profissional",
  ESCALA: "Escala",
};

export function planLabel(plan: Plan | null): string {
  return plan ? LABELS[plan] : "—";
}
