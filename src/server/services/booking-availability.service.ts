import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import {
  appointmentEnd,
  computeDaySlots,
  enumerateLocalDates,
} from "@/lib/agenda/availability";
import { resolveWorkingWindows } from "./professional.service";

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
