import { prisma } from "@/server/db/client";
import type { Lead, LeadStatus, Prisma } from "@prisma/client";
import { parseLeadsCsv } from "@/lib/csv";
import { normalizePhone } from "@/lib/phone";
import { normalizeEmail } from "@/lib/email";
import { mergeCustomFields } from "@/server/services/custom-field.service";
import { invalidateLeadCaches } from "@/server/cache/keys";

export interface LeadTag {
  id: string;
  name: string;
  color: string;
}

export interface LeadListItem {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: LeadStatus;
  score: number;
  optOut: boolean;
  campaignName: string | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  tags: LeadTag[];
  updatedAt: Date;
}

export interface ListLeadsParams {
  assignedToId?: string;
  skip?: number; // default 0
  take?: number; // default 50, cap 100
  query?: string; // busca em name/phone
  status?: LeadStatus;
  campaignId?: string | null; // null = sem campanha
  optOut?: boolean;
  tagId?: string;
}

export interface ListLeadsResult {
  items: LeadListItem[];
  total: number;
}

/**
 * Lista leads para o dashboard de forma PAGINADA e FILTRÁVEL no servidor, já com
 * a última mensagem e nome da campanha. Ordena por atividade recente (updatedAt
 * desc). Escopo: conta do usuário. Devolve a página (`items`) + total filtrado
 * (`total`) p/ a UI montar a paginação sem carregar tudo.
 */
export async function listLeads(
  userId: string,
  params: ListLeadsParams = {},
): Promise<ListLeadsResult> {
  const take = Math.min(params.take ?? 50, 100);
  const skip = params.skip ?? 0;
  const where: Prisma.LeadWhereInput = {
    userId,
    ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.campaignId === null
      ? { campaignId: null }
      : params.campaignId
        ? { campaignId: params.campaignId }
        : {}),
    ...(params.optOut !== undefined ? { optOut: params.optOut } : {}),
    ...(params.tagId ? { tags: { some: { id: params.tagId } } } : {}),
    ...(params.query
      ? {
          OR: [
            { name: { contains: params.query, mode: "insensitive" as const } },
            { phone: { contains: params.query } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      include: {
        campaign: { select: { name: true } },
        tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true },
        },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return {
    items: rows.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      status: l.status,
      score: l.score,
      optOut: l.optOut,
      campaignName: l.campaign?.name ?? null,
      lastMessage: l.messages[0]?.content ?? null,
      lastMessageAt: l.messages[0]?.createdAt ?? null,
      tags: l.tags,
      updatedAt: l.updatedAt,
    })),
    total,
  };
}

/** Detalhe completo de um lead: mensagens (cronológicas), qualificação e reunião. */
export async function getLeadDetail(
  id: string,
  userId: string,
  opts: { assignedToId?: string } = {},
) {
  return prisma.lead.findFirst({
    where: { id, userId, ...(opts.assignedToId ? { assignedToId: opts.assignedToId } : {}) },
    include: {
      campaign: { select: { id: true, name: true } },
      tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
      qualification: true,
      meeting: true,
    },
  });
}

export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLeadDetail>>>;

/** Cria um lead avulso (NOVO). Idempotente por telefone POR conta. */
export async function createLead(
  userId: string,
  name: string,
  rawPhone: string,
  rawEmail?: string,
): Promise<Lead> {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    throw new Error(`Telefone inválido: ${rawPhone}`);
  }
  const email = normalizeEmail(rawEmail);
  if (rawEmail?.trim() && !email) throw new Error(`E-mail inválido: ${rawEmail}`);
  // Idempotente por (userId, phone) sem depender do unique — a identidade do
  // contato passou a ser (whatsAppNumberId, phone), então não há mais composite
  // userId_phone em Lead.
  const existing = await prisma.lead.findFirst({ where: { userId, phone }, select: { id: true } });
  let lead: Lead;
  if (existing) {
    lead = await prisma.lead.update({
      where: { id: existing.id },
      data: { name, ...(email ? { email } : {}) },
    });
  } else {
    // consentSource só no create: preserva a origem do opt-in mesmo se reimportado (LGPD)
    lead = await prisma.lead.create({
      data: { userId, name, phone, email, status: "NOVO", consentSource: "manual" },
    });
  }
  await invalidateLeadCaches(userId); // contadores/facetas mudaram
  return lead;
}

/**
 * Edita um lead. Telefone, se informado, é normalizado para E.164; conflito de
 * telefone (já usado por outro lead) vira erro amigável.
 */
export async function updateLead(
  id: string,
  userId: string,
  data: {
    name?: string;
    phone?: string;
    email?: string;
    status?: LeadStatus;
    optOut?: boolean;
    customFields?: Record<string, unknown>;
  },
): Promise<Lead> {
  const exists = await prisma.lead.findFirst({
    where: { id, userId },
    select: { id: true, customFields: true },
  });
  if (!exists) throw new Error("Lead não encontrado");

  const patch: Prisma.LeadUpdateInput = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.status !== undefined) patch.status = data.status;
  if (data.customFields !== undefined) {
    patch.customFields = (await mergeCustomFields(
      userId,
      exists.customFields,
      data.customFields,
    )) as Prisma.InputJsonValue;
  }
  if (data.email !== undefined) {
    // string vazia limpa o e-mail; valor preenchido precisa ser válido.
    const email = data.email.trim() ? normalizeEmail(data.email) : null;
    if (data.email.trim() && !email) throw new Error("E-mail inválido.");
    patch.email = email;
  }
  if (data.optOut !== undefined) {
    patch.optOut = data.optOut;
    patch.optOutAt = data.optOut ? new Date() : null;
  }
  if (data.phone !== undefined) {
    const phone = normalizePhone(data.phone);
    if (!phone) throw new Error(`Telefone inválido: ${data.phone}`);
    const clash = await prisma.lead.findFirst({
      where: { userId, phone },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      throw new Error("Já existe outro lead com este telefone.");
    }
    patch.phone = phone;
  }

  const updated = await prisma.lead.update({ where: { id }, data: patch });
  await invalidateLeadCaches(userId); // status/opt-out podem ter mudado
  return updated;
}

/** Apaga um lead e tudo associado (mensagens, qualificação, reunião, jobs — cascade). */
export async function deleteLead(id: string, userId: string): Promise<void> {
  const exists = await prisma.lead.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw new Error("Lead não encontrado");
  await prisma.lead.delete({ where: { id } });
  await invalidateLeadCaches(userId);
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
export async function importLeadsFromCsv(
  userId: string,
  content: string,
): Promise<ImportResult> {
  const { valid, invalid } = parseLeadsCsv(content);

  // Dedup dentro do próprio arquivo (último vence) + contra o banco (por conta).
  const byPhone = new Map<string, string>();
  for (const row of valid) byPhone.set(row.phone, row.name);

  const phones = [...byPhone.keys()];
  const existing = await prisma.lead.findMany({
    where: { userId, phone: { in: phones } },
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
    toCreate.push({ userId, name, phone, status: "NOVO", consentSource: "csv_import" });
  }

  if (toCreate.length > 0) {
    await prisma.lead.createMany({ data: toCreate });
    await invalidateLeadCaches(userId);
  }

  return {
    created: toCreate.length,
    skippedDuplicates: skipped,
    invalid: invalid.map((i) => ({ line: i.line, reason: i.reason })),
  };
}
