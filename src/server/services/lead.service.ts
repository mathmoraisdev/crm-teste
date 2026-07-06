import { prisma } from "@/server/db/client";
import type { AttendanceStatus, Lead, LeadStatus, Prisma } from "@prisma/client";
import { parseLeadsCsv } from "@/lib/csv";
import { normalizePhone } from "@/lib/phone";
import { normalizeEmail } from "@/lib/email";
import { normalizeDocument } from "@/lib/document";
import { isAdminEmail } from "@/lib/admin";
import { PLAN_LIMITS } from "@/lib/plans";
import { mergeCustomFields } from "@/server/services/custom-field.service";
import { invalidateLeadCaches } from "@/server/cache/keys";

/**
 * Capacidade de contatos do plano. grandfather (plan=null)/admin = ilimitado.
 * Gate de criação DELIBERADA (manual + import CSV). Inbound orgânico do WhatsApp
 * NÃO passa por aqui — não faz sentido perder um lead real que chegou sozinho.
 */
export async function contactCapacity(
  userId: string,
): Promise<{ unlimited: boolean; max: number; used: number; remaining: number }> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true },
  });
  if (!owner) throw new Error("Conta não encontrada");
  if (!owner.plan || isAdminEmail(owner.email)) {
    return { unlimited: true, max: Infinity, used: 0, remaining: Infinity };
  }
  const max = PLAN_LIMITS[owner.plan].maxContacts;
  const used = await prisma.lead.count({ where: { userId } });
  return { unlimited: false, max, used, remaining: Math.max(0, max - used) };
}

/** Lança se o plano já atingiu o teto de contatos (criação deliberada). */
export async function assertContactQuota(userId: string): Promise<void> {
  const cap = await contactCapacity(userId);
  if (!cap.unlimited && cap.remaining <= 0) {
    throw new Error(
      `Seu plano permite ${cap.max.toLocaleString("pt-BR")} contatos (limite atingido). Faça upgrade para adicionar mais.`,
    );
  }
}

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
  // Contexto de atendimento p/ o card do kanban sinalizar "precisa de humano".
  attendanceStatus: AttendanceStatus;
  queuedAt: Date | null;
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
      ? (() => {
          const q = params.query.trim();
          // Telefone é salvo em E.164 só-dígitos (+55...). Busca por dígitos p/
          // casar mesmo quando o usuário digita com máscara "(11) 98888-1111"
          // ou sem o DDI. Espelha o que o AgendaView já faz no cliente.
          const digits = q.replace(/\D/g, "");
          const or: Prisma.LeadWhereInput[] = [
            { name: { contains: q, mode: "insensitive" as const } },
          ];
          if (digits.length >= 3) or.push({ phone: { contains: digits } });
          return { OR: or };
        })()
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
      attendanceStatus: l.attendanceStatus,
      queuedAt: l.queuedAt,
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
      messages: {
        orderBy: { createdAt: "asc" },
        // Citação (reply): inclui um resumo da msg citada p/ a bolha renderizar.
        include: { replyTo: { select: { id: true, content: true, direction: true } } },
      },
      qualification: true,
      meeting: true,
      // Venda mais recente (funil de vendas): oferta, valor, status e Pix.
      sales: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { offer: { select: { name: true } } },
      },
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
  extra?: { personType?: "PF" | "PJ"; document?: string | null },
): Promise<Lead> {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    throw new Error(`Telefone inválido: ${rawPhone}`);
  }
  const email = normalizeEmail(rawEmail);
  if (rawEmail?.trim() && !email) throw new Error(`E-mail inválido: ${rawEmail}`);
  const personType = extra?.personType ?? "PF";
  const document = normalizeDocument(extra?.document, personType);
  // Idempotente por (userId, phone) sem depender do unique — a identidade do
  // contato passou a ser (whatsAppNumberId, phone), então não há mais composite
  // userId_phone em Lead.
  const existing = await prisma.lead.findFirst({ where: { userId, phone }, select: { id: true } });
  let lead: Lead;
  if (existing) {
    lead = await prisma.lead.update({
      where: { id: existing.id },
      data: { name, ...(email ? { email } : {}), personType, ...(document ? { document } : {}) },
    });
  } else {
    await assertContactQuota(userId); // teto de contatos do plano (só no novo)
    // consentSource só no create: preserva a origem do opt-in mesmo se reimportado (LGPD)
    lead = await prisma.lead.create({
      data: { userId, name, phone, email, personType, document, status: "NOVO", consentSource: "manual" },
    });
  }
  await invalidateLeadCaches(userId); // contadores/facetas mudaram
  return lead;
}

/**
 * Lead "leve" a partir do auto-agendamento público (Onda F). Difere do `createLead`
 * interno: escolhe o CHIP primário da conta (p/ o lembrete ter por onde sair) e
 * deduplica pela identidade real do contato — (whatsAppNumberId, phone) quando há
 * chip, senão (userId, phone). Retorna `null` quando o teto de contatos estoura:
 * é o SINAL de "cai para walk-in" (o confirm marca sem virar contato/lembrete).
 * `consentSource: "public_booking"` registra a origem do opt-in (o cliente marcou).
 */
export async function resolveOrCreatePublicLead(
  accountId: string,
  input: { name: string; phone: string },
): Promise<Lead | null> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error(`Telefone inválido: ${input.phone}`);
  const name = input.name.trim() || phone; // sem nome → o telefone é o rótulo inicial

  // Chip primário: um CONECTADO de preferência; senão qualquer; senão nenhum.
  const chip =
    (await prisma.whatsAppNumber.findFirst({
      where: { userId: accountId, status: "CONNECTED" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.whatsAppNumber.findFirst({
      where: { userId: accountId },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }));

  // Dedupe pela identidade do contato: com chip, por (whatsAppNumberId, phone);
  // sem chip, por (userId, phone).
  const existing = chip
    ? await prisma.lead.findFirst({
        where: { whatsAppNumberId: chip.id, phone },
        select: { id: true, name: true },
      })
    : await prisma.lead.findFirst({
        where: { userId: accountId, phone },
        select: { id: true, name: true },
      });
  if (existing) {
    // Atualiza o nome só se antes era o placeholder (o próprio telefone).
    if (existing.name === phone && name !== phone) {
      return prisma.lead.update({ where: { id: existing.id }, data: { name } });
    }
    return prisma.lead.findUniqueOrThrow({ where: { id: existing.id } });
  }

  // Novo contato: respeita o teto do plano. Estourou → null (o confirm vira walk-in).
  try {
    await assertContactQuota(accountId);
  } catch {
    return null;
  }
  const lead = await prisma.lead.create({
    data: {
      userId: accountId,
      whatsAppNumberId: chip?.id ?? null,
      phone,
      name,
      status: "NOVO",
      consentSource: "public_booking",
    },
  });
  await invalidateLeadCaches(accountId);
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
    personType?: "PF" | "PJ";
    document?: string | null;
  },
): Promise<Lead> {
  const exists = await prisma.lead.findFirst({
    where: { id, userId },
    select: { id: true, customFields: true, personType: true },
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
      "LEAD",
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
  if (data.personType !== undefined) patch.personType = data.personType;
  if (data.document !== undefined || data.personType !== undefined) {
    const type = data.personType ?? exists.personType; // tipo efetivo, sem 2ª query
    patch.document = normalizeDocument(data.document ?? null, type);
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

/**
 * Reativa um lead que saiu do fluxo por opt-out/descarte. Faz os DOIS gates numa
 * tacada, evitando o estado inconsistente de mexer só no status (kanban) e deixar
 * o `optOut` ligado (IA volta, mas campanha segue bloqueada):
 *  - `status` volta a EM_CONVERSA → destrava a resposta da IA (respondToLead);
 *  - `optOut`/`optOutAt` limpos → destrava outbound/campanhas (dispatchOutboundJob).
 * Ação deliberada do operador (LGPD): o contato pediu para não ser abordado, então
 * a reversão é sempre manual — nunca automática.
 */
export async function reactivateLead(id: string, userId: string): Promise<Lead> {
  const exists = await prisma.lead.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw new Error("Lead não encontrado");
  const updated = await prisma.lead.update({
    where: { id },
    data: { status: "EM_CONVERSA", optOut: false, optOutAt: null },
  });
  await invalidateLeadCaches(userId); // status/opt-out mudaram → facets do CRM/inbox
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
  skippedOverLimit: number; // não criados por estourar o teto de contatos do plano
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

  // Teto de contatos do plano: importa até a capacidade restante e reporta o
  // excedente (não trava o import inteiro por causa do limite).
  const cap = await contactCapacity(userId);
  let batch = toCreate;
  let skippedOverLimit = 0;
  if (!cap.unlimited && toCreate.length > cap.remaining) {
    batch = toCreate.slice(0, cap.remaining);
    skippedOverLimit = toCreate.length - batch.length;
  }

  if (batch.length > 0) {
    await prisma.lead.createMany({ data: batch });
    await invalidateLeadCaches(userId);
  }

  return {
    created: batch.length,
    skippedDuplicates: skipped,
    skippedOverLimit,
    invalid: invalid.map((i) => ({ line: i.line, reason: i.reason })),
  };
}
