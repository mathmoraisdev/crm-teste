import { prisma } from "@/server/db/client";
import type { Lead, LeadStatus, Prisma } from "@prisma/client";
import { parseLeadsCsv } from "@/lib/csv";
import { normalizePhone } from "@/lib/phone";

export interface LeadListItem {
  id: string;
  name: string;
  phone: string;
  status: LeadStatus;
  score: number;
  optOut: boolean;
  campaignName: string | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  updatedAt: Date;
}

/**
 * Lista leads para o dashboard, já com a última mensagem e nome da campanha.
 * Ordena por atividade recente (updatedAt desc).
 */
export async function listLeads(): Promise<LeadListItem[]> {
  const leads = await prisma.lead.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      campaign: { select: { name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
  });

  return leads.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    status: l.status,
    score: l.score,
    optOut: l.optOut,
    campaignName: l.campaign?.name ?? null,
    lastMessage: l.messages[0]?.content ?? null,
    lastMessageAt: l.messages[0]?.createdAt ?? null,
    updatedAt: l.updatedAt,
  }));
}

/** Detalhe completo de um lead: mensagens (cronológicas), qualificação e reunião. */
export async function getLeadDetail(id: string) {
  return prisma.lead.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "asc" } },
      qualification: true,
      meeting: true,
    },
  });
}

export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLeadDetail>>>;

/** Cria um lead avulso (NOVO). Idempotente por telefone (upsert do nome). */
export async function createLead(name: string, rawPhone: string): Promise<Lead> {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    throw new Error(`Telefone inválido: ${rawPhone}`);
  }
  return prisma.lead.upsert({
    where: { phone },
    update: { name },
    create: { name, phone, status: "NOVO" },
  });
}

/**
 * Edita um lead. Telefone, se informado, é normalizado para E.164; conflito de
 * telefone (já usado por outro lead) vira erro amigável.
 */
export async function updateLead(
  id: string,
  data: { name?: string; phone?: string; status?: LeadStatus; optOut?: boolean },
): Promise<Lead> {
  const exists = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new Error("Lead não encontrado");

  const patch: Prisma.LeadUpdateInput = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.status !== undefined) patch.status = data.status;
  if (data.optOut !== undefined) {
    patch.optOut = data.optOut;
    patch.optOutAt = data.optOut ? new Date() : null;
  }
  if (data.phone !== undefined) {
    const phone = normalizePhone(data.phone);
    if (!phone) throw new Error(`Telefone inválido: ${data.phone}`);
    const clash = await prisma.lead.findUnique({ where: { phone }, select: { id: true } });
    if (clash && clash.id !== id) {
      throw new Error("Já existe outro lead com este telefone.");
    }
    patch.phone = phone;
  }

  return prisma.lead.update({ where: { id }, data: patch });
}

/** Apaga um lead e tudo associado (mensagens, qualificação, reunião, jobs — cascade). */
export async function deleteLead(id: string): Promise<void> {
  const exists = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new Error("Lead não encontrado");
  await prisma.lead.delete({ where: { id } });
}

export interface ImportResult {
  created: number;
  skippedDuplicates: number;
  invalid: { line: number; reason: string }[];
}

/**
 * Importa leads de um CSV. Dedupe por telefone (não recria quem já existe).
 * Devolve um resumo para a UI mostrar quantos entraram e o que foi rejeitado.
 */
export async function importLeadsFromCsv(content: string): Promise<ImportResult> {
  const { valid, invalid } = parseLeadsCsv(content);

  // Dedup dentro do próprio arquivo (último vence) + contra o banco.
  const byPhone = new Map<string, string>();
  for (const row of valid) byPhone.set(row.phone, row.name);

  const phones = [...byPhone.keys()];
  const existing = await prisma.lead.findMany({
    where: { phone: { in: phones } },
    select: { phone: true },
  });
  const existingSet = new Set(existing.map((e) => e.phone));

  const toCreate: Prisma.LeadCreateManyInput[] = [];
  let skipped = 0;
  for (const [phone, name] of byPhone) {
    if (existingSet.has(phone)) {
      skipped++;
      continue;
    }
    toCreate.push({ name, phone, status: "NOVO" });
  }

  if (toCreate.length > 0) {
    await prisma.lead.createMany({ data: toCreate });
  }

  return {
    created: toCreate.length,
    skippedDuplicates: skipped,
    invalid: invalid.map((i) => ({ line: i.line, reason: i.reason })),
  };
}
