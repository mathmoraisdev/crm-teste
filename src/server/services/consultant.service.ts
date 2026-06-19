import { prisma } from "@/server/db/client";
import type { ConsultantLead } from "@prisma/client";
import { normalizeEmail } from "@/lib/email";
import { env } from "@/lib/env";

// Número placeholder usado quando CONSULTANT_WHATSAPP não está configurado —
// garante que o caminho feliz SEMPRE redirecione ao WhatsApp, mesmo sem env.
const PLACEHOLDER_WHATSAPP = "5511999999999";

export interface CreateConsultantLeadInput {
  name: string;
  whatsapp: string;
  email?: string;
  plan?: string;
  message?: string;
  source?: string;
}

/**
 * Grava um lead do funil "fale com nosso consultor". É público (sem auth) e não
 * tem dono (a cobrança é manual pelo time). E-mail, se informado, precisa ser
 * válido — vazio/ausente vira null.
 */
export async function createConsultantLead(
  input: CreateConsultantLeadInput,
): Promise<ConsultantLead> {
  const name = input.name.trim();
  if (!name) throw new Error("Informe seu nome.");

  const whatsapp = input.whatsapp.trim();
  if (!whatsapp) throw new Error("Informe seu WhatsApp.");

  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  if (input.email?.trim() && !email) throw new Error("E-mail inválido.");

  return prisma.consultantLead.create({
    data: {
      name,
      whatsapp,
      email,
      plan: input.plan?.trim() || null,
      message: input.message?.trim() || null,
      source: input.source?.trim() || "landing",
    },
  });
}

/** Lista os leads do funil de consultor para o admin (mais recentes primeiro). */
export async function listConsultantLeads(): Promise<ConsultantLead[]> {
  return prisma.consultantLead.findMany({ orderBy: { createdAt: "desc" } });
}

/**
 * Monta a URL do WhatsApp do time para onde o prospect é enviado, já com uma
 * mensagem pré-preenchida (nome + plano de interesse). Usa CONSULTANT_WHATSAPP;
 * se vazio, cai no número placeholder para nunca quebrar o redirecionamento.
 */
export function buildWhatsappUrl(lead: {
  name: string;
  plan?: string | null;
}): string {
  const number = env.CONSULTANT_WHATSAPP || PLACEHOLDER_WHATSAPP;
  const plano = lead.plan?.trim();
  const message = plano
    ? `Olá! Sou ${lead.name} e tenho interesse no plano ${plano} do Disparador.ai. Pode me ajudar?`
    : `Olá! Sou ${lead.name} e quero falar com um consultor do Disparador.ai.`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
