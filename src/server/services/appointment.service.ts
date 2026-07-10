import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import type { AppointmentStatus, AppointmentSource, Prisma } from "@prisma/client";
import type { ApptReply } from "@/server/ai/schemas";
import { env } from "@/lib/env";
import { formatSlot } from "@/lib/utils";
import {
  overlaps,
  appointmentEnd,
  isWithinWorkingHours,
  localWeekdayAndMinutes,
  type DayWindow,
} from "@/lib/agenda/availability";

const TZ = env.SCHEDULING_TIMEZONE;

/**
 * Client de banco: a instância global OU um client de transação. Os helpers de
 * leitura/validação aceitam este tipo para poderem correr DENTRO de uma transação
 * interativa (ex.: `confirmBooking`) usando a MESMA conexão. Sem isso, um `prisma`
 * global chamado dentro de uma `$transaction` pede uma 2ª conexão ao pool e, com
 * `connection_limit=1`, trava (self-deadlock → pool timeout). Default = `prisma`.
 */
type Db = Prisma.TransactionClient;

/**
 * Trava anti-corrida de agendamento, POR PROFISSIONAL (não por horário exato).
 * Serializa QUALQUER criação no mesmo profissional dentro da transação — fecha a
 * janela em que dois horários DIFERENTES que se sobrepõem (ex.: serviço de 60 min
 * às 10:00 vs 10:15) passariam ambos na checagem. Vive até o commit; contenção
 * desprezível (agendamento é raro, transação curta). `hashtext` → int4, cabe no
 * bigint do advisory lock. Chave única: use SEMPRE este helper (nunca monte a chave
 * na mão), senão dois caminhos travam em chaves diferentes e não serializam.
 */
export async function lockProfessionalForBooking(
  tx: Prisma.TransactionClient,
  professionalId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking|${professionalId}`}))`;
}

/**
 * Trava anti-corrida POR CONTA, para o modo "recurso único" (negócio de uma pessoa
 * SEM profissional cadastrado): todos os agendamentos disputam uma única agenda.
 * Serializa criações/edições sem profissional na mesma conta. Chave em namespace
 * próprio (`booking|acct|…`), não colide com a trava por profissional (UUID).
 */
export async function lockAccountForBooking(
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking|acct|${accountId}`}))`;
}

export interface ApptTransition {
  status: "CONFIRMADO" | "CANCELADO" | null; // null = não mexe no status
  needsReview: boolean;
  reviewReason: string;
}

/**
 * PURA: traduz a classificação da resposta do cliente numa transição de status.
 * Só aplica CONFIRMADO/CANCELADO quando a IA está CONFIANTE. Qualquer dúvida
 * (reschedule, não-confiante) só acende a revisão, sem mexer no status.
 * `unclear` = a mensagem não era sobre o agendamento → nenhuma ação (null).
 */
export function decideApptTransition(reply: ApptReply): ApptTransition | null {
  if (reply.intent === "unclear") return null;
  if (!reply.confident) {
    return { status: null, needsReview: true, reviewReason: "Resposta ambígua ao lembrete — conferir" };
  }
  switch (reply.intent) {
    case "confirm":
      return { status: "CONFIRMADO", needsReview: true, reviewReason: "Cliente confirmou pelo WhatsApp" };
    case "decline":
      return { status: "CANCELADO", needsReview: true, reviewReason: "Cliente recusou/desmarcou pelo WhatsApp" };
    case "reschedule":
      return { status: null, needsReview: true, reviewReason: "Cliente pediu para remarcar" };
  }
}

/**
 * Efeito: aplica a transição decidida a um agendamento (scoping por conta).
 * Reusa a validação de posse via loadOwned.
 */
export async function applyApptTransition(userId: string, id: string, t: ApptTransition) {
  await loadOwned(userId, id);
  return prisma.appointment.update({
    where: { id },
    data: {
      ...(t.status ? { status: t.status } : {}),
      needsReview: t.needsReview,
      reviewReason: t.reviewReason,
    },
  });
}

/**
 * Agendamentos de serviço (Appointment): N por Lead, ≠ Meeting (1:1, "reunião de
 * venda"). Scoping por `lead.userId` QUANDO há lead; walk-in (sem cadastro) escopa
 * por `accountId`. Todo caminho que grava valida antes que o lead/profissional/
 * comanda pertence à conta.
 */

/** Confere que o lead é da conta antes de agendar (evita gravar em lead de outro dono). */
async function assertLeadOwned(userId: string, leadId: string, db: Db = prisma): Promise<void> {
  const lead = await db.lead.findFirst({ where: { id: leadId, userId }, select: { id: true } });
  if (!lead) throw new Error("Cliente não encontrado.");
}

/** Confere que o profissional é da conta antes de vincular (evita referência cross-tenant). */
async function assertProfessionalOwned(
  userId: string,
  professionalId: string,
  db: Db = prisma,
): Promise<void> {
  const p = await db.professional.findFirst({
    where: { id: professionalId, accountId: userId },
    select: { id: true },
  });
  if (!p) throw new Error("Profissional não encontrado.");
}

/** Snapshot do nome do serviço: usa o informado ou, se veio catalogItemId, o do item. */
async function resolveServiceName(
  userId: string,
  catalogItemId: string | null | undefined,
  serviceName: string | null | undefined,
  db: Db = prisma,
): Promise<{ catalogItemId: string | null; serviceName: string | null }> {
  const name = serviceName?.trim();
  if (catalogItemId) {
    const ci = await db.catalogItem.findFirst({
      where: { id: catalogItemId, accountId: userId },
      select: { id: true, name: true },
    });
    if (!ci) throw new Error("Item do catálogo não encontrado.");
    return { catalogItemId: ci.id, serviceName: name || ci.name };
  }
  return { catalogItemId: null, serviceName: name || null };
}

/**
 * Snapshot da duração (min): usa a informada; senão, se veio catalogItemId,
 * copia a duração do item; senão null (agendamento pontual, sem janela). Espelha
 * `resolveServiceName` — a duração vira snapshot e sobrevive à edição do item.
 */
async function resolveDuration(
  userId: string,
  catalogItemId: string | null | undefined,
  durationMinutes: number | null | undefined,
  db: Db = prisma,
): Promise<number | null> {
  if (durationMinutes != null) return durationMinutes;
  if (catalogItemId) {
    const ci = await db.catalogItem.findFirst({
      where: { id: catalogItemId, accountId: userId },
      select: { durationMinutes: true },
    });
    return ci?.durationMinutes ?? null;
  }
  return null;
}

/** Scoping resolvido de um agendamento: OU lead (da conta) OU walk-in (accountId). */
interface ResolvedScope {
  leadId: string | null;
  accountId: string | null;
  customerName: string | null;
  customerPhone: string | null;
}

/**
 * Resolve o dono do agendamento. Com leadId: valida posse e escopa por lead
 * (accountId fica null, retrocompat). Sem leadId (walk-in): exige customerName e
 * escopa por accountId = conta. Uma linha tem SEMPRE leadId OU accountId.
 */
async function resolveScope(
  userId: string,
  input: CreateAppointmentInput,
  db: Db = prisma,
): Promise<ResolvedScope> {
  if (input.leadId) {
    await assertLeadOwned(userId, input.leadId, db);
    return { leadId: input.leadId, accountId: null, customerName: null, customerPhone: null };
  }
  const name = input.customerName?.trim();
  if (!name) throw new Error("Informe o nome do cliente.");
  return {
    leadId: null,
    accountId: userId,
    customerName: name,
    customerPhone: input.customerPhone?.trim() || null,
  };
}

/**
 * Carrega as janelas de expediente aplicáveis ao profissional no dia do slot.
 * Prioriza a grade PRÓPRIA do profissional; se ele não tem grade nesse dia, cai
 * no expediente PADRÃO da conta (professionalId null). Vazio = sem expediente
 * configurado (o chamador decide não bloquear).
 */
async function loadWorkingWindows(
  userId: string,
  professionalId: string,
  start: Date,
  db: Db = prisma,
): Promise<DayWindow[]> {
  const { weekday } = localWeekdayAndMinutes(start, TZ);
  const own = await db.workingHours.findMany({
    where: { accountId: userId, professionalId, weekday },
    select: { startMinute: true, endMinute: true, breakStart: true, breakEnd: true },
  });
  const rows =
    own.length > 0
      ? own
      : await db.workingHours.findMany({
          where: { accountId: userId, professionalId: null, weekday },
          select: { startMinute: true, endMinute: true, breakStart: true, breakEnd: true },
        });
  return rows.map((r) => ({
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    breakStart: r.breakStart,
    breakEnd: r.breakEnd,
  }));
}

/**
 * Verdadeiro sse há expediente configurado para o dia E o slot [start,end) cai
 * FORA dele. Sem expediente configurado => false (não bloqueia — a conta não
 * definiu grade). É um AVISO, não uma regra rígida: o chamador pode forçar.
 */
async function isOutsideWorkingHours(
  userId: string,
  professionalId: string,
  start: Date,
  end: Date,
  db: Db = prisma,
): Promise<boolean> {
  const windows = await loadWorkingWindows(userId, professionalId, start, db);
  if (windows.length === 0) return false;
  const { minuteOfDay: slotStartMin } = localWeekdayAndMinutes(start, TZ);
  const { minuteOfDay: slotEndMin } = localWeekdayAndMinutes(end, TZ);
  return !isWithinWorkingHours(slotStartMin, slotEndMin, windows);
}

/**
 * Agendamentos ATIVOS (AGENDADO/CONFIRMADO) do profissional cujo intervalo
 * [scheduledAt, fim) sobrepõe [start, end). O profissional é único da conta, mas
 * filtramos também por conta (defesa em profundidade). Busca candidatos por uma
 * janela grosseira de `scheduledAt` (um agendamento com duração pode COMEÇAR
 * antes de `start` e ainda sobrepor) e refina com a `overlaps()` pura.
 */
export async function conflictsFor(
  accountId: string,
  professionalId: string,
  start: Date,
  end: Date,
  exceptId?: string,
  db: Db = prisma,
): Promise<{ id: string; scheduledAt: Date; serviceName: string | null }[]> {
  // Janela grosseira p/ trás: cobre agendamentos que começam antes mas se estendem
  // até `start`. 24h folga com sobra a durações reais (minutos/horas).
  const COARSE_BACK_MS = 24 * 60 * 60 * 1000;
  const candidates = await db.appointment.findMany({
    where: {
      professionalId,
      professional: { accountId },
      status: { in: ["AGENDADO", "CONFIRMADO"] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
      // scheduledAt >= end nunca sobrepõe [start,end); < end é o teto seguro.
      scheduledAt: { gte: new Date(start.getTime() - COARSE_BACK_MS), lt: end },
    },
    select: { id: true, scheduledAt: true, durationMinutes: true, serviceName: true },
  });
  return candidates
    .filter((c) =>
      overlaps(start, end, c.scheduledAt, appointmentEnd(c.scheduledAt, c.durationMinutes)),
    )
    .map((c) => ({ id: c.id, scheduledAt: c.scheduledAt, serviceName: c.serviceName }));
}

interface SlotGuardOpts {
  allowOverlap?: boolean;
  force?: boolean;
  exceptId?: string;
}

/**
 * Guarda de slot p/ um profissional: bloqueia sobreposição (salvo allowOverlap) e
 * horário fora do expediente (salvo force). Prefixos distintos (CONFLICT: /
 * OUTSIDE_HOURS:) deixam a API mapear p/ 409 e a UI oferecer o override.
 */
async function assertSlotFree(
  userId: string,
  professionalId: string,
  start: Date,
  durationMinutes: number | null,
  opts: SlotGuardOpts,
  db: Db = prisma,
): Promise<void> {
  const end = appointmentEnd(start, durationMinutes);
  if (!opts.allowOverlap) {
    const conflicts = await conflictsFor(userId, professionalId, start, end, opts.exceptId, db);
    if (conflicts.length > 0) {
      throw new Error("CONFLICT: Profissional já tem agendamento nesse horário.");
    }
  }
  if (!opts.force && (await isOutsideWorkingHours(userId, professionalId, start, end, db))) {
    throw new Error("OUTSIDE_HOURS: Fora do horário de funcionamento do profissional.");
  }
}

/**
 * Conta em modo "recurso único": NENHUM profissional ativo cadastrado. Nesse caso o
 * negócio é uma pessoa/uma agenda só, então agendamentos SEM profissional disputam
 * o mesmo horário. Com profissional cadastrado, "sem profissional" = "não atribuído"
 * e mantém o comportamento antigo (não bloqueia).
 */
async function isSingleResourceAccount(accountId: string, db: Db = prisma): Promise<boolean> {
  const n = await db.professional.count({ where: { accountId, active: true } });
  return n === 0;
}

/**
 * Agendamentos SEM profissional da conta (walk-in por accountId OU lead da conta)
 * cujo intervalo sobrepõe [start, end). Espelha `conflictsFor`, mas na agenda única
 * do modo "recurso único".
 */
async function accountConflictsFor(
  accountId: string,
  start: Date,
  end: Date,
  exceptId: string | undefined,
  db: Db = prisma,
): Promise<{ id: string }[]> {
  const COARSE_BACK_MS = 24 * 60 * 60 * 1000;
  const candidates = await db.appointment.findMany({
    where: {
      professionalId: null,
      OR: [{ accountId }, { lead: { userId: accountId } }],
      status: { in: ["AGENDADO", "CONFIRMADO"] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
      scheduledAt: { gte: new Date(start.getTime() - COARSE_BACK_MS), lt: end },
    },
    select: { id: true, scheduledAt: true, durationMinutes: true },
  });
  return candidates
    .filter((c) => overlaps(start, end, c.scheduledAt, appointmentEnd(c.scheduledAt, c.durationMinutes)))
    .map((c) => ({ id: c.id }));
}

/**
 * Guarda de sobreposição do modo "recurso único" (conta sem profissional): trava por
 * conta e barra outro agendamento sem profissional que cruze [start, fim). Roda
 * DENTRO da transação. Assume que já se decidiu guardar (conta solo, sem allowOverlap).
 */
async function assertAccountSlotFree(
  accountId: string,
  start: Date,
  durationMinutes: number | null,
  exceptId: string | undefined,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await lockAccountForBooking(tx, accountId);
  const end = appointmentEnd(start, durationMinutes);
  const conflicts = await accountConflictsFor(accountId, start, end, exceptId, tx);
  if (conflicts.length > 0) {
    throw new Error("CONFLICT: Já existe agendamento nesse horário.");
  }
}

export interface CreateAppointmentInput {
  leadId?: string | null; // opcional: walk-in não tem lead
  customerName?: string | null; // walk-in: nome livre (obrigatório sem lead)
  customerPhone?: string | null; // walk-in: telefone opcional
  scheduledAt: Date;
  catalogItemId?: string | null;
  serviceName?: string | null;
  durationMinutes?: number | null;
  professionalId?: string | null;
  note?: string | null;
  createdById: string;
  source?: AppointmentSource; // origem; ausente = MANUAL (default do banco)
  allowOverlap?: boolean; // override do bloqueio de conflito
  force?: boolean; // override do aviso de fora-do-expediente
}

/**
 * Reserva `count` números sequenciais de agendamento para a conta (tenant), sob
 * advisory lock POR conta (serializa o max+1 — dois agendamentos simultâneos não
 * colidem no nº). A conta efetiva é `accountId` (walk-in) OU `lead.userId` (com
 * lead), então o max cobre os dois. Retorna o PRIMEIRO nº da faixa. Recebe um
 * client de transação (o lock vive até o commit dela).
 */
async function reserveAppointmentNumbers(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appt:${userId}`}))`;
  const [byAccount, byLead] = await Promise.all([
    tx.appointment.aggregate({ where: { accountId: userId }, _max: { number: true } }),
    tx.appointment.aggregate({ where: { lead: { userId } }, _max: { number: true } }),
  ]);
  return Math.max(byAccount._max.number ?? 0, byLead._max.number ?? 0) + 1;
}

/**
 * Cria um agendamento avulso, snapshotando nome+duração do serviço e atribuindo o
 * nº sequencial da conta (Onda M). `tx` opcional: quando chamado DENTRO de uma
 * transação (ex.: confirmBooking, que já segura a trava do slot), reusa o mesmo
 * client em vez de abrir uma transação aninhada (que esgotaria o pool).
 */
export async function createAppointment(
  userId: string,
  input: CreateAppointmentInput,
  tx?: Prisma.TransactionClient,
) {
  // Dentro de uma transação (tx presente), TODAS as leituras/validações correm no
  // MESMO client — senão pedem uma 2ª conexão ao pool e travam com connection_limit=1.
  const db = tx ?? prisma;
  const scope = await resolveScope(userId, input, db);
  const { catalogItemId, serviceName } = await resolveServiceName(
    userId,
    input.catalogItemId,
    input.serviceName,
    db,
  );
  const durationMinutes = await resolveDuration(userId, catalogItemId, input.durationMinutes, db);
  if (input.professionalId) {
    await assertProfessionalOwned(userId, input.professionalId, db);
  }
  // Trava + checagem de slot + insert ATÔMICOS na MESMA transação: sem isso, dois
  // pedidos concorrentes passam ambos na checagem (feita antes do insert) e criam
  // sobreposição. A trava é por profissional (fecha horários diferentes que se cruzam).
  const run = async (client: Prisma.TransactionClient) => {
    if (input.professionalId) {
      await lockProfessionalForBooking(client, input.professionalId);
      await assertSlotFree(
        userId,
        input.professionalId,
        input.scheduledAt,
        durationMinutes,
        { allowOverlap: input.allowOverlap, force: input.force },
        client,
      );
    } else if (!input.allowOverlap && (await isSingleResourceAccount(userId, client))) {
      // Sem profissional numa conta de uma pessoa só → agenda única: barra sobreposição.
      await assertAccountSlotFree(userId, input.scheduledAt, durationMinutes, undefined, client);
    }
    return client.appointment.create({
      data: {
        leadId: scope.leadId,
        accountId: scope.accountId,
        customerName: scope.customerName,
        customerPhone: scope.customerPhone,
        scheduledAt: input.scheduledAt,
        catalogItemId,
        serviceName,
        durationMinutes,
        professionalId: input.professionalId ?? null,
        note: input.note?.trim() || null,
        createdById: input.createdById,
        number: await reserveAppointmentNumbers(client, userId),
        ...(input.source ? { source: input.source } : {}),
      },
    });
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

const MAX_SERIES = 52; // teto de sessões numa série (cobre 1 por semana por 1 ano)

/**
 * Gera uma SÉRIE (pacote): `count` agendamentos com o mesmo `seriesId`, espaçados
 * de `everyDays` dias a partir de `base.scheduledAt`. Cobre "10 sessões, 1 por
 * semana". Cria tudo numa transação (ou entra a série inteira, ou nada). O
 * conflito é conferido POR SESSÃO — a primeira colisão aborta a série toda.
 */
export async function createSeries(
  userId: string,
  base: CreateAppointmentInput,
  opts: { everyDays: number; count: number },
) {
  const scope = await resolveScope(userId, base);
  const count = Math.floor(opts.count);
  const everyDays = Math.floor(opts.everyDays);
  if (count < 1 || count > MAX_SERIES) throw new Error(`Quantidade de sessões inválida (1 a ${MAX_SERIES}).`);
  if (everyDays < 1) throw new Error("Intervalo entre sessões inválido.");

  const { catalogItemId, serviceName } = await resolveServiceName(
    userId,
    base.catalogItemId,
    base.serviceName,
  );
  const durationMinutes = await resolveDuration(userId, catalogItemId, base.durationMinutes);
  const seriesId = randomUUID();
  const start = base.scheduledAt.getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const sessions = Array.from({ length: count }, (_, i) => new Date(start + i * everyDays * DAY_MS));

  if (base.professionalId) {
    await assertProfessionalOwned(userId, base.professionalId);
  }

  // Numeração sequencial (Onda M) sob advisory lock: a série reserva `count` números
  // contíguos e cria tudo na mesma transação (ou entra inteira, ou nada). A checagem
  // de conflito por sessão roda AQUI DENTRO, sob a trava por profissional — atômica
  // com o createMany (sem isso, dois pedidos concorrentes passariam ambos na checagem).
  return prisma.$transaction(async (tx) => {
    if (base.professionalId) {
      const profId = base.professionalId;
      await lockProfessionalForBooking(tx, profId);
      for (const at of sessions) {
        const end = appointmentEnd(at, durationMinutes);
        if (!base.allowOverlap) {
          const conflicts = await conflictsFor(userId, profId, at, end, undefined, tx);
          if (conflicts.length > 0) {
            throw new Error(
              `CONFLICT: Profissional já tem agendamento em ${formatSlot(at.toISOString(), TZ)}.`,
            );
          }
        }
        if (!base.force && (await isOutsideWorkingHours(userId, profId, at, end, tx))) {
          throw new Error("OUTSIDE_HOURS: Fora do horário de funcionamento do profissional.");
        }
      }
    } else if (!base.allowOverlap && (await isSingleResourceAccount(userId, tx))) {
      // Conta de uma pessoa só (sem profissional) → agenda única: cada sessão barra sobreposição.
      for (const at of sessions) {
        await assertAccountSlotFree(userId, at, durationMinutes, undefined, tx);
      }
    }
    const startNumber = await reserveAppointmentNumbers(tx, userId);
    const rows: Prisma.AppointmentCreateManyInput[] = sessions.map((at, i) => ({
      leadId: scope.leadId,
      accountId: scope.accountId,
      customerName: scope.customerName,
      customerPhone: scope.customerPhone,
      scheduledAt: at,
      catalogItemId,
      serviceName,
      durationMinutes,
      professionalId: base.professionalId ?? null,
      note: base.note?.trim() || null,
      seriesId,
      createdById: base.createdById,
      number: startNumber + i,
    }));
    await tx.appointment.createMany({ data: rows });
    return { seriesId, count };
  });
}

export interface ListAppointmentsParams {
  from?: Date;
  to?: Date;
  leadId?: string;
  professionalId?: string;
  status?: AppointmentStatus;
  needsReview?: boolean;
}

/**
 * Lista agendamentos da conta (lead da conta OU walk-in por accountId), do mais
 * próximo ao mais distante. Filtros opcionais por janela (from/to), lead,
 * profissional e status. Traz lead (nullable), profissional e item de catálogo
 * embutidos p/ a UI; os escalares (customerName/phone/duração/etc.) vêm por padrão.
 */
export async function listAppointments(userId: string, params: ListAppointmentsParams = {}) {
  const where: Prisma.AppointmentWhereInput = {
    OR: [{ lead: { userId } }, { accountId: userId }],
    ...(params.leadId ? { leadId: params.leadId } : {}),
    ...(params.professionalId ? { professionalId: params.professionalId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.needsReview !== undefined ? { needsReview: params.needsReview } : {}),
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
      professional: { select: { id: true, name: true, color: true } },
    },
  });
}

/** Carrega um agendamento garantindo que é da conta (lead ou walk-in). Lança se não. */
async function loadOwned(userId: string, id: string) {
  const appt = await prisma.appointment.findFirst({
    where: { id, OR: [{ lead: { userId } }, { accountId: userId }] },
    select: {
      id: true,
      scheduledAt: true,
      professionalId: true,
      durationMinutes: true,
      catalogItemId: true,
    },
  });
  if (!appt) throw new Error("Agendamento não encontrado.");
  return appt;
}

export interface UpdateAppointmentInput {
  scheduledAt?: Date;
  status?: AppointmentStatus;
  catalogItemId?: string | null;
  serviceName?: string | null;
  durationMinutes?: number | null;
  professionalId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  orderId?: string | null; // liga/desliga a comanda gerada (ex.: ao marcar REALIZADO)
  allowOverlap?: boolean; // override do bloqueio de conflito
  force?: boolean; // override do aviso de fora-do-expediente
}

/** Confere que a comanda é da conta antes de vincular (evita referência cross-tenant). */
async function assertOrderOwned(userId: string, orderId: string): Promise<void> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, accountId: userId },
    select: { id: true },
  });
  if (!order) throw new Error("Comanda não encontrada.");
}

/** Edita um agendamento (reagendar/trocar serviço/profissional/status). Scoping por conta. */
export async function updateAppointment(userId: string, id: string, input: UpdateAppointmentInput) {
  const current = await loadOwned(userId, id);
  const data: Prisma.AppointmentUpdateInput = {};
  if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt;
  if (input.status !== undefined) {
    data.status = input.status;
    // A equipe decidiu o status manualmente → a revisão foi feita (baixa o badge).
    data.needsReview = false;
    data.reviewReason = null;
  }
  if (input.note !== undefined) data.note = input.note?.trim() || null;
  if (input.customerName !== undefined) data.customerName = input.customerName?.trim() || null;
  if (input.customerPhone !== undefined) data.customerPhone = input.customerPhone?.trim() || null;

  // Trocar o item do catálogo re-snapshota nome E duração (salvo valores explícitos)
  // e religa/desliga o vínculo. Mandar SÓ serviceName renomeia o snapshot SEM mexer
  // no vínculo com o catálogo (renomear ≠ desvincular).
  let effectiveDuration = current.durationMinutes;
  if (input.catalogItemId !== undefined) {
    const { catalogItemId, serviceName } = await resolveServiceName(
      userId,
      input.catalogItemId,
      input.serviceName,
    );
    data.serviceName = serviceName;
    data.catalogItem = catalogItemId ? { connect: { id: catalogItemId } } : { disconnect: true };
    effectiveDuration = await resolveDuration(userId, catalogItemId, input.durationMinutes);
    data.durationMinutes = effectiveDuration;
  } else if (input.serviceName !== undefined) {
    data.serviceName = input.serviceName?.trim() || null;
  }
  if (input.durationMinutes !== undefined && input.catalogItemId === undefined) {
    effectiveDuration = input.durationMinutes;
    data.durationMinutes = effectiveDuration;
  }

  // Profissional: valida posse; connect/disconnect conforme informado.
  let effectiveProfessionalId = current.professionalId;
  if (input.professionalId !== undefined) {
    if (input.professionalId) await assertProfessionalOwned(userId, input.professionalId);
    effectiveProfessionalId = input.professionalId;
    data.professional = input.professionalId
      ? { connect: { id: input.professionalId } }
      : { disconnect: true };
  }

  if (input.orderId !== undefined) {
    if (input.orderId) {
      await assertOrderOwned(userId, input.orderId);
      data.order = { connect: { id: input.orderId } };
    } else {
      data.order = { disconnect: true };
    }
  }

  // Sem profissional no resultado: conta de uma pessoa só (recurso único) ainda barra
  // sobreposição na agenda única; conta COM profissionais trata "sem profissional"
  // como "não atribuído" e faz o update direto (sem risco de disputa de recurso).
  if (!effectiveProfessionalId) {
    const effectiveStart = input.scheduledAt ?? current.scheduledAt;
    if (input.allowOverlap || !(await isSingleResourceAccount(userId))) {
      return prisma.appointment.update({ where: { id }, data });
    }
    return prisma.$transaction(async (tx) => {
      await assertAccountSlotFree(userId, effectiveStart, effectiveDuration, id, tx);
      return tx.appointment.update({ where: { id }, data });
    });
  }

  // Com profissional: trava por profissional + recheca de slot + update ATÔMICOS na
  // mesma transação (igual aos caminhos de criação). Sem isso, dois reagendamentos
  // concorrentes p/ o mesmo slot sobreposto passariam ambos na checagem (feita antes
  // do update). Exclui a própria linha (exceptId) p/ não colidir consigo mesmo.
  const profId = effectiveProfessionalId;
  const effectiveStart = input.scheduledAt ?? current.scheduledAt;
  return prisma.$transaction(async (tx) => {
    await lockProfessionalForBooking(tx, profId);
    await assertSlotFree(
      userId,
      profId,
      effectiveStart,
      effectiveDuration,
      { allowOverlap: input.allowOverlap, force: input.force, exceptId: id },
      tx,
    );
    return tx.appointment.update({ where: { id }, data });
  });
}

/** Cancela um agendamento (mantém o registro; muda status p/ CANCELADO). */
export async function cancelAppointment(userId: string, id: string) {
  await loadOwned(userId, id);
  return prisma.appointment.update({
    where: { id },
    data: { status: "CANCELADO", needsReview: false, reviewReason: null },
  });
}

/** Marca como REALIZADO, opcionalmente ligando a comanda gerada (orderId). */
export async function markRealized(userId: string, id: string, opts: { orderId?: string } = {}) {
  await loadOwned(userId, id);
  if (opts.orderId) await assertOrderOwned(userId, opts.orderId);
  return prisma.appointment.update({
    where: { id },
    data: {
      status: "REALIZADO",
      needsReview: false,
      reviewReason: null,
      ...(opts.orderId ? { orderId: opts.orderId } : {}),
    },
  });
}
