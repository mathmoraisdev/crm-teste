import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { formatSlot } from "@/lib/utils";
import {
  appointmentEnd,
  computeDaySlots,
  enumerateLocalDates,
} from "@/lib/agenda/availability";
import { resolveWorkingWindows } from "./professional.service";
import { conflictsFor, createAppointment } from "./appointment.service";
import { resolveOrCreatePublicLead } from "./lead.service";
import { sendWhatsAppMessage } from "./messaging";

/**
 * Disponibilidade pública do auto-agendamento (Onda F). Monta os insumos do banco
 * — serviço (duração), profissionais, ocupados, expediente — e delega ao motor PURO
 * de `availability.ts`. Nada aqui é autenticado; o scoping é sempre por `accountId`
 * (a conta já foi resolvida pelo slug na borda). Só LÊ do domínio da Agenda Pro.
 */

const TZ = env.SCHEDULING_TIMEZONE;
const COARSE_BACK_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BookableService {
  id: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
}

export interface BookableProfessional {
  id: string;
  name: string;
  color: string;
}

export interface AvailableSlot {
  startISO: string;
  professionalId: string;
  professionalName: string;
}

/** Serviços agendáveis: SERVICO ativos com duração > 0. */
export async function listBookableServices(accountId: string): Promise<BookableService[]> {
  const rows = await prisma.catalogItem.findMany({
    where: { accountId, active: true, kind: "SERVICO", durationMinutes: { gt: 0 } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, priceCents: true, durationMinutes: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priceCents: r.priceCents,
    durationMinutes: r.durationMinutes ?? 0,
  }));
}

/** Profissionais agendáveis: ativos da conta. */
export async function listBookableProfessionals(
  accountId: string,
): Promise<BookableProfessional[]> {
  const rows = await prisma.professional.findMany({
    where: { accountId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });
  return rows;
}

/** Config de booking da conta (limites que o serviço respeita). */
async function loadBookingConfig(accountId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      bookingLeadMinutes: true,
      bookingHorizonDays: true,
      bookingSlotStep: true,
    },
  });
}

/** Resolve o serviço agendável (posse + duração). Lança mensagem legível se inválido. */
async function resolveBookableService(accountId: string, catalogItemId: string) {
  const service = await prisma.catalogItem.findFirst({
    where: { id: catalogItemId, accountId, active: true, kind: "SERVICO" },
    select: { id: true, name: true, durationMinutes: true },
  });
  if (!service) throw new Error("Serviço não encontrado.");
  if (!service.durationMinutes || service.durationMinutes <= 0) {
    throw new Error("Esse serviço não tem duração configurada.");
  }
  return { id: service.id, name: service.name, durationMinutes: service.durationMinutes };
}

/** Resolve os profissionais-alvo: um específico (valida posse+ativo) OU todos os ativos. */
async function resolveTargetProfessionals(
  accountId: string,
  professionalId: string | null | undefined,
): Promise<BookableProfessional[]> {
  if (professionalId) {
    const p = await prisma.professional.findFirst({
      where: { id: professionalId, accountId, active: true },
      select: { id: true, name: true, color: true },
    });
    if (!p) throw new Error("Profissional não encontrado.");
    return [p];
  }
  return listBookableProfessionals(accountId);
}

export interface AvailableSlotsQuery {
  catalogItemId: string;
  professionalId?: string | null; // ausente = "sem preferência" (todos os ativos)
  fromUtc: Date;
  toUtc: Date;
}

/**
 * Lista os horários LIVRES no intervalo pedido. Carrega serviço, profissionais e
 * ocupados uma vez, varre profissional × dia resolvendo o expediente (memoizado por
 * weekday) e delega ao `computeDaySlots`. `notBefore` = agora + antecedência mínima;
 * `toUtc` é limitado ao horizonte (`bookingHorizonDays`). No modo "sem preferência",
 * deduplica por horário guardando o 1º profissional livre (o confirm decide).
 */
export async function getAvailableSlots(
  accountId: string,
  query: AvailableSlotsQuery,
): Promise<AvailableSlot[]> {
  const cfg = await loadBookingConfig(accountId);
  const service = await resolveBookableService(accountId, query.catalogItemId);
  const pros = await resolveTargetProfessionals(accountId, query.professionalId);
  if (pros.length === 0) return [];

  const now = new Date();
  const notBefore = new Date(now.getTime() + cfg.bookingLeadMinutes * 60_000);
  const horizonEnd = new Date(now.getTime() + cfg.bookingHorizonDays * DAY_MS);
  const effFrom = query.fromUtc;
  const effTo = query.toUtc.getTime() > horizonEnd.getTime() ? horizonEnd : query.toUtc;
  if (effTo.getTime() < effFrom.getTime()) return [];

  // Ocupados (ativos) de TODOS os profissionais-alvo numa varredura só, agrupados.
  const appts = await prisma.appointment.findMany({
    where: {
      professionalId: { in: pros.map((p) => p.id) },
      professional: { accountId },
      status: { in: ["AGENDADO", "CONFIRMADO"] },
      scheduledAt: { gte: new Date(effFrom.getTime() - COARSE_BACK_MS), lt: effTo },
    },
    select: { professionalId: true, scheduledAt: true, durationMinutes: true },
  });
  const busyByPro = new Map<string, { start: Date; end: Date }[]>();
  for (const a of appts) {
    if (!a.professionalId) continue;
    const list = busyByPro.get(a.professionalId) ?? [];
    list.push({ start: a.scheduledAt, end: appointmentEnd(a.scheduledAt, a.durationMinutes) });
    busyByPro.set(a.professionalId, list);
  }

  const days = enumerateLocalDates(effFrom, effTo, TZ);

  // Memoiza janelas por (profissional, weekday) — o expediente só depende do weekday.
  const windowCache = new Map<string, Awaited<ReturnType<typeof resolveWorkingWindows>>>();
  const windowsFor = async (professionalId: string, weekday: number) => {
    const key = `${professionalId}:${weekday}`;
    const cached = windowCache.get(key);
    if (cached) return cached;
    const win = await resolveWorkingWindows(accountId, professionalId, weekday);
    windowCache.set(key, win);
    return win;
  };

  const out: AvailableSlot[] = [];
  for (const pro of pros) {
    const busy = busyByPro.get(pro.id) ?? [];
    for (const d of days) {
      const windows = await windowsFor(pro.id, d.weekday);
      if (windows.length === 0) continue;
      const slots = computeDaySlots({
        date: { year: d.year, month: d.month, day: d.day },
        timeZone: TZ,
        windows,
        busy,
        durationMinutes: service.durationMinutes,
        stepMinutes: cfg.bookingSlotStep,
        notBefore,
      });
      for (const s of slots) {
        out.push({ startISO: s.toISOString(), professionalId: pro.id, professionalName: pro.name });
      }
    }
  }

  out.sort((a, b) => (a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0));

  // "Sem preferência": um horário aparece uma vez, com o 1º profissional livre.
  if (!query.professionalId) {
    const byTime = new Map<string, AvailableSlot>();
    for (const s of out) if (!byTime.has(s.startISO)) byTime.set(s.startISO, s);
    return [...byTime.values()];
  }
  return out;
}

export interface ConfirmBookingInput {
  catalogItemId: string;
  professionalId: string; // o slot ofertado sempre carrega um profissional concreto
  startISO: string;
  customerName: string;
  customerPhone: string;
}

export interface ConfirmBookingResult {
  appointmentId: string;
  leadId: string | null;
  isWalkIn: boolean;
}

/**
 * Confirma um agendamento vindo do link público. Revalida no SERVIDOR (não confia
 * no cliente): conta ligada, serviço com duração, `startISO` dentro de
 * [notBefore, horizonte]. A criação corre sob `pg_advisory_xact_lock` por
 * (profissional | horário): dois estranhos disputando o mesmo slot serializam — o
 * 2º vê o conflito e recebe **CONFLICT:**. Resolve o cliente (lead leve com chip
 * OU walk-in) e cria pelo MESMO `createAppointment` interno (sem allowOverlap/force
 * → conflito/expediente continuam barrados no serviço). Se criou lead com chip,
 * dispara a confirmação por WhatsApp; o lembrete véspera/1h sai depois pelo worker.
 */
export async function confirmBooking(
  accountId: string,
  input: ConfirmBookingInput,
): Promise<ConfirmBookingResult> {
  // 1. revalida conta + serviço + janela temporal
  const acct = await prisma.user.findUniqueOrThrow({
    where: { id: accountId },
    select: { bookingEnabled: true, bookingLeadMinutes: true, bookingHorizonDays: true },
  });
  if (!acct.bookingEnabled) throw new Error("Agendamento indisponível.");
  const service = await resolveBookableService(accountId, input.catalogItemId);

  const start = new Date(input.startISO);
  if (Number.isNaN(start.getTime())) throw new Error("Horário inválido.");
  const now = new Date();
  const notBefore = new Date(now.getTime() + acct.bookingLeadMinutes * 60_000);
  const horizonEnd = new Date(now.getTime() + acct.bookingHorizonDays * DAY_MS);
  if (start.getTime() < notBefore.getTime()) {
    throw new Error("CONFLICT: Esse horário já não está disponível.");
  }
  if (start.getTime() > horizonEnd.getTime()) {
    throw new Error("Fora da janela de agendamento.");
  }

  // posse do profissional (ativo) — o slot público sempre vem com um profissional.
  const pro = await prisma.professional.findFirst({
    where: { id: input.professionalId, accountId, active: true },
    select: { id: true },
  });
  if (!pro) throw new Error("Profissional não encontrado.");

  // 2. guarda anti-corrida + 3./4. resolve cliente e cria — tudo sob a trava do slot.
  const lockKey = `booking|${input.professionalId}|${input.startISO}`;
  const created = await prisma.$transaction(async (tx) => {
    // A trava vive até o fim da transação: enquanto este confirm roda, outro no
    // MESMO slot fica bloqueado aqui — quando destrava, já vê o agendamento e cai
    // no CONFLICT. `hashtext` → int4 (cabe no bigint do advisory lock).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    // Pré-checa o conflito ANTES de resolver o cliente (evita lead órfão no slot tomado).
    const end = appointmentEnd(start, service.durationMinutes);
    const conflicts = await conflictsFor(accountId, input.professionalId, start, end);
    if (conflicts.length > 0) {
      throw new Error("CONFLICT: Esse horário acabou de ser preenchido.");
    }

    const lead = await resolveOrCreatePublicLead(accountId, {
      name: input.customerName,
      phone: input.customerPhone,
    });

    const appt = await createAppointment(accountId, {
      ...(lead
        ? { leadId: lead.id }
        : { customerName: input.customerName, customerPhone: input.customerPhone }),
      scheduledAt: start,
      catalogItemId: service.id,
      professionalId: input.professionalId,
      createdById: accountId, // autoatendimento: a própria conta é a autora
      source: "ONLINE", // veio do link público → selo/filtro na Agenda
    });
    return { appt, lead };
  }, {
    // Teto default do Prisma é 5s. Em serverless "frio" (Vercel→Supabase) o
    // handshake de conexão + as várias queries sob a trava passam de 5s e a
    // transação expira. 15s cobre o cold start; maxWait dá folga p/ pegar conexão.
    timeout: 15_000,
    maxWait: 10_000,
  });

  // 5. confirmação por WhatsApp — só p/ lead COM chip. Falha aqui não derruba a marcação.
  if (created.lead?.whatsAppNumberId) {
    const quando = formatSlot(input.startISO, TZ);
    try {
      await sendWhatsAppMessage(
        {
          id: created.lead.id,
          phone: created.lead.phone,
          userId: accountId,
          whatsAppNumberId: created.lead.whatsAppNumberId,
        },
        `Agendamento confirmado: ${service.name} em ${quando} 😊`,
        { source: "SYSTEM" },
      );
    } catch (e) {
      console.error(
        `[booking] confirmação WhatsApp falhou (appt=${created.appt.id}):`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return {
    appointmentId: created.appt.id,
    leadId: created.lead?.id ?? null,
    isWalkIn: !created.lead,
  };
}
