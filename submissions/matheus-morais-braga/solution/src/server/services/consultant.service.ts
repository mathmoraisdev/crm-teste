import { prisma } from "@/server/db/client";
import type { ConsultantLead } from "@prisma/client";
import { normalizeEmail, sendEmail } from "@/lib/email";
import { adminEmailSet } from "@/lib/admin";
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

/** Quantos leads ainda não vistos pelo admin (alimenta o badge do sidebar). */
export async function countNewConsultantLeads(): Promise<number> {
  return prisma.consultantLead.count({ where: { status: "NOVO" } });
}

/** Marca todos os leads NOVO como VISTO (chamado quando o admin abre /consultores). */
export async function markConsultantLeadsSeen(): Promise<void> {
  await prisma.consultantLead.updateMany({
    where: { status: "NOVO" },
    data: { status: "VISTO" },
  });
}

/**
 * Avisa os admins da plataforma por e-mail que chegou um lead novo do funil de
 * consultor. Fire-and-forget do ponto de vista do chamador: `sendEmail` nunca
 * lança, então uma falha de e-mail nunca derruba a gravação do lead. No-op se
 * não houver admins configurados (ADMIN_EMAILS vazio).
 */
export async function notifyAdminsOfLead(lead: ConsultantLead): Promise<void> {
  const admins = [...adminEmailSet()];
  if (admins.length === 0) return;

  const linha = (rotulo: string, valor?: string | null) =>
    valor ? `<p style="margin:4px 0"><strong>${rotulo}:</strong> ${valor}</p>` : "";

  const url = `${env.APP_URL.replace(/\/$/, "")}/consultores`;
  const html = `
    <div style="font-family:system-ui,sans-serif;font-size:14px;color:#0f172a">
      <h2 style="margin:0 0 12px">Novo contato no funil &ldquo;fale com nosso consultor&rdquo;</h2>
      ${linha("Nome", lead.name)}
      ${linha("WhatsApp", lead.whatsapp)}
      ${linha("E-mail", lead.email)}
      ${linha("Plano de interesse", lead.plan)}
      ${linha("Mensagem", lead.message)}
      ${linha("Origem", lead.source)}
      <p style="margin:16px 0 0">
        <a href="${url}" style="color:#059669">Ver em Consultores &rarr;</a>
      </p>
    </div>`;
  const text = [
    "Novo contato no funil 'fale com nosso consultor'",
    `Nome: ${lead.name}`,
    `WhatsApp: ${lead.whatsapp}`,
    lead.email ? `E-mail: ${lead.email}` : null,
    lead.plan ? `Plano: ${lead.plan}` : null,
    lead.message ? `Mensagem: ${lead.message}` : null,
    `Origem: ${lead.source}`,
    "",
    `Ver em: ${url}`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendEmail({
    to: admins.join(", "),
    subject: `Novo lead consultor: ${lead.name}`,
    html,
    text,
  });
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
