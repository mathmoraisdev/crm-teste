import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import type { AppointmentStatus, Prisma } from "@prisma/client";

/**
 * Agendamentos de serviço (Appointment): N por Lead, ≠ Meeting (1:1, "reunião de
 * venda"). Scoping SEMPRE por `lead.userId` — Appointment não tem userId próprio,
 * igual Meeting. Todo caminho que grava valida antes que o lead pertence à conta.
 */

/** Confere que o lead é da conta antes de agendar (evita gravar em lead de outro dono). */
async function assertLeadOwned(userId: string, leadId: string): Promise<void> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, userId }, select: { id: true } });
  if (!lead) throw new Error("Cliente não encontrado.");
}

/** Snapshot do nome do serviço: usa o informado ou, se veio catalogItemId, o do item. */
async function resolveServiceName(
  userId: string,
  catalogItemId: string | null | undefined,
  serviceName: string | null | undefined,
): Promise<{ catalogItemId: string | null; serviceName: string | null }> {
  const name = serviceName?.trim();
  if (catalogItemId) {
    const ci = await prisma.catalogItem.findFirst({
      where: { id: catalogItemId, accountId: userId },
      select: { id: true, name: true },
    });
    if (!ci) throw new Error("Item do catálogo não encontrado.");
    return { catalogItemId: ci.id, serviceName: name || ci.name };
  }
  return { catalogItemId: null, serviceName: name || null };
}

export interface CreateAppointmentInput {
  leadId: string;
  scheduledAt: Date;
  catalogItemId?: string | null;
  serviceName?: string | null;
  note?: string | null;
  createdById: string;
}

/** Cria um agendamento avulso, snapshotando o nome do serviço. */
export async function createAppointment(userId: string, input: CreateAppointmentInput) {
  await assertLeadOwned(userId, input.leadId);
  const { catalogItemId, serviceName } = await resolveServiceName(
    userId,
    input.catalogItemId,
    input.serviceName,
  );
  return prisma.appointment.create({
    data: {
      leadId: input.leadId,
      scheduledAt: input.scheduledAt,
      catalogItemId,
      serviceName,
      note: input.note?.trim() || null,
      createdById: input.createdById,
    },
  });
}

const MAX_SERIES = 52; // teto de sessões numa série (cobre 1 por semana por 1 ano)

/**
 * Gera uma SÉRIE (pacote): `count` agendamentos com o mesmo `seriesId`, espaçados
 * de `everyDays` dias a partir de `base.scheduledAt`. Cobre "10 sessões, 1 por
 * semana". Cria tudo numa transação (ou entra a série inteira, ou nada).
 */
export async function createSeries(
  userId: string,
  base: CreateAppointmentInput,
  opts: { everyDays: number; count: number },
) {
  await assertLeadOwned(userId, base.leadId);
  const count = Math.floor(opts.count);
  const everyDays = Math.floor(opts.everyDays);
  if (count < 1 || count > MAX_SERIES) throw new Error(`Quantidade de sessões inválida (1 a ${MAX_SERIES}).`);
  if (everyDays < 1) throw new Error("Intervalo entre sessões inválido.");

  const { catalogItemId, serviceName } = await resolveServiceName(
    userId,
    base.catalogItemId,
    base.serviceName,
  );
  const seriesId = randomUUID();
  const start = base.scheduledAt.getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const rows: Prisma.AppointmentCreateManyInput[] = Array.from({ length: count }, (_, i) => ({
    leadId: base.leadId,
    scheduledAt: new Date(start + i * everyDays * DAY_MS),
    catalogItemId,
    serviceName,
    note: base.note?.trim() || null,
    seriesId,
    createdById: base.createdById,
  }));

  await prisma.appointment.createMany({ data: rows });
  return { seriesId, count };
}

export interface ListAppointmentsParams {
  from?: Date;
  to?: Date;
  leadId?: string;
  status?: AppointmentStatus;
}

/**
 * Lista agendamentos da conta (scoping por `lead.userId`), do mais próximo ao mais
 * distante. Filtros opcionais por janela (from/to), lead e status. Traz o lead
 * (id/name/phone) e o item de catálogo embutidos p/ a UI.
 */
export async function listAppointments(userId: string, params: ListAppointmentsParams = {}) {
  const where: Prisma.AppointmentWhereInput = {
    lead: { userId },
    ...(params.leadId ? { leadId: params.leadId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.from || params.to
      ? { scheduledAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
      : {}),
  };
  return prisma.appointment.findMany({
    where,
    orderBy: { scheduledAt: "asc" },
    include: {
      lead: { select: { id: true, name: true, phone: true } },
      catalogItem: { select: { id: true, name: true } },
    },
  });
}

/** Carrega um agendamento garantindo que o lead é da conta. Lança se não for. */
async function loadOwned(userId: string, id: string) {
  const appt = await prisma.appointment.findFirst({
    where: { id, lead: { userId } },
    select: { id: true },
  });
  if (!appt) throw new Error("Agendamento não encontrado.");
  return appt;
}

export interface UpdateAppointmentInput {
  scheduledAt?: Date;
  status?: AppointmentStatus;
  catalogItemId?: string | null;
  serviceName?: string | null;
  note?: string | null;
}

/** Edita um agendamento (reagendar/trocar serviço/observação/status). Scoping por conta. */
export async function updateAppointment(userId: string, id: string, input: UpdateAppointmentInput) {
  await loadOwned(userId, id);
  const data: Prisma.AppointmentUpdateInput = {};
  if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt;
  if (input.status !== undefined) data.status = input.status;
  if (input.note !== undefined) data.note = input.note?.trim() || null;
  // Trocar o serviço re-snapshota o nome (a menos que serviceName venha explícito).
  if (input.catalogItemId !== undefined || input.serviceName !== undefined) {
    const { catalogItemId, serviceName } = await resolveServiceName(
      userId,
      input.catalogItemId,
      input.serviceName,
    );
    data.serviceName = serviceName;
    data.catalogItem = catalogItemId
      ? { connect: { id: catalogItemId } }
      : { disconnect: true };
  }
  return prisma.appointment.update({ where: { id }, data });
}

/** Cancela um agendamento (mantém o registro; muda status p/ CANCELADO). */
export async function cancelAppointment(userId: string, id: string) {
  await loadOwned(userId, id);
  return prisma.appointment.update({ where: { id }, data: { status: "CANCELADO" } });
}

/** Marca como REALIZADO, opcionalmente ligando a comanda gerada (orderId). */
export async function markRealized(userId: string, id: string, opts: { orderId?: string } = {}) {
  await loadOwned(userId, id);
  return prisma.appointment.update({
    where: { id },
    data: { status: "REALIZADO", ...(opts.orderId ? { orderId: opts.orderId } : {}) },
  });
}
