import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import {
  enumerateLocalDates,
  zonedWallTimeToUtc,
  localWeekdayAndMinutes,
} from "@/lib/agenda/availability";
import { createProfessional, setWorkingHours } from "./professional.service";
import { createCatalogItem } from "./catalog.service";
import { createAppointment } from "./appointment.service";
import {
  listBookableServices,
  listBookableProfessionals,
  getAvailableSlots,
  confirmBooking,
} from "./booking-availability.service";
import { sendWhatsAppMessage } from "./messaging";

// Não dispara WhatsApp de verdade nos testes — só verifica se foi chamado.
vi.mock("./messaging", () => ({ sendWhatsAppMessage: vi.fn() }));

const TZ = env.SCHEDULING_TIMEZONE;
const DAY_MS = 24 * 60 * 60 * 1000;

async function makeOwner() {
  const u = await prisma.user.create({
    data: {
      email: `bavail_${Math.round(performance.now())}_${Math.random()}@t.test`,
      name: "Dono",
      passwordHash: "x",
      bookingEnabled: true, // confirmBooking exige a conta ligada
      bookingSlotStep: 30, // grade de 30min p/ asserções limpas
    },
  });
  return u.id;
}

/** Profissional cru (retorna só o id) — igual ao helper de appointment.service.test.ts. */
async function makeProfessional(userId: string, name = "Profissional") {
  const p = await prisma.professional.create({ data: { accountId: userId, name } });
  return p.id;
}

async function makeChip(accountId: string, status: "CONNECTED" | "PAUSED" = "CONNECTED") {
  const n = await prisma.whatsAppNumber.create({
    data: {
      userId: accountId,
      label: "chip",
      phone: `+55119${Math.floor(Math.random() * 100000000)}`,
      sessionDir: `sess_${Math.round(performance.now())}_${Math.random()}`,
      status,
    },
  });
  return n.id;
}

/** Um dia-calendário local seguro (dentro de lead+horizonte) e seus insumos. */
function pickTargetDay(daysAhead = 5) {
  const now = new Date();
  const days = enumerateLocalDates(
    new Date(now.getTime() + (daysAhead - 1) * DAY_MS),
    new Date(now.getTime() + (daysAhead + 1) * DAY_MS),
    TZ,
  );
  const target = days[1] ?? days[0];
  const fromUtc = zonedWallTimeToUtc(target.year, target.month, target.day, 0, TZ);
  const toUtc = new Date(fromUtc.getTime() + DAY_MS);
  return { target, fromUtc, toUtc };
}

/** Minuto-do-dia local de cada slot, p/ asserção legível. */
function localMinutes(slots: { startISO: string }[]): number[] {
  return slots.map((s) => localWeekdayAndMinutes(new Date(s.startISO), TZ).minuteOfDay);
}

const H = (h: number, m = 0) => h * 60 + m;

describe("booking-availability.service — listagens", () => {
  it("listBookableServices só traz SERVICO ativo com duração > 0", async () => {
    const acc = await makeOwner();
    await createCatalogItem(acc, { name: "Corte", priceCents: 5000, kind: "SERVICO", durationMinutes: 30 });
    await createCatalogItem(acc, { name: "Sem duração", priceCents: 1000, kind: "SERVICO", durationMinutes: 0 });
    await createCatalogItem(acc, { name: "Shampoo", priceCents: 2000, kind: "PRODUTO", durationMinutes: 0 });
    const services = await listBookableServices(acc);
    expect(services.map((s) => s.name)).toEqual(["Corte"]);
    expect(services[0].durationMinutes).toBe(30);
  });

  it("listBookableProfessionals só traz ativos", async () => {
    const acc = await makeOwner();
    await createProfessional(acc, { name: "Ana" });
    const bea = await createProfessional(acc, { name: "Bea" });
    await prisma.professional.update({ where: { id: bea.id }, data: { active: false } });
    const pros = await listBookableProfessionals(acc);
    expect(pros.map((p) => p.name)).toEqual(["Ana"]);
  });
});

describe("booking-availability.service — getAvailableSlots", () => {
  it("serviço 60min + expediente 09–12 → 09:00/09:30/10:00/10:30/11:00", async () => {
    const acc = await makeOwner();
    const pro = await createProfessional(acc, { name: "Ana" });
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 5000, kind: "SERVICO", durationMinutes: 60 });
    const { target, fromUtc, toUtc } = pickTargetDay();
    await setWorkingHours(acc, pro.id, [{ weekday: target.weekday, startMinute: H(9), endMinute: H(12) }]);

    const slots = await getAvailableSlots(acc, {
      catalogItemId: svc.id,
      professionalId: pro.id,
      fromUtc,
      toUtc,
    });
    expect(localMinutes(slots)).toEqual([H(9), H(9, 30), H(10), H(10, 30), H(11)]);
    expect(slots.every((s) => s.professionalId === pro.id)).toBe(true);
  });

  it("um agendamento 10–11 remove 09:30/10:00/10:30", async () => {
    const acc = await makeOwner();
    const pro = await createProfessional(acc, { name: "Ana" });
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 5000, kind: "SERVICO", durationMinutes: 60 });
    const { target, fromUtc, toUtc } = pickTargetDay();
    await setWorkingHours(acc, pro.id, [{ weekday: target.weekday, startMinute: H(9), endMinute: H(12) }]);

    // Ocupa 10:00–11:00 (walk-in) — força expediente com `force` (garante gravação).
    const at10 = zonedWallTimeToUtc(target.year, target.month, target.day, H(10), TZ);
    await createAppointment(acc, {
      customerName: "Fulano",
      scheduledAt: at10,
      professionalId: pro.id,
      durationMinutes: 60,
      createdById: acc,
      force: true,
    });

    const slots = await getAvailableSlots(acc, {
      catalogItemId: svc.id,
      professionalId: pro.id,
      fromUtc,
      toUtc,
    });
    expect(localMinutes(slots)).toEqual([H(9), H(11)]);
  });

  it("modo 'sem preferência' une dois profissionais e deduplica por horário", async () => {
    const acc = await makeOwner();
    const ana = await createProfessional(acc, { name: "Ana" });
    const bea = await createProfessional(acc, { name: "Bea" });
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 5000, kind: "SERVICO", durationMinutes: 60 });
    const { target, fromUtc, toUtc } = pickTargetDay();
    // Ana 09–11, Bea 10–12 → união de inícios: 09:00,09:30,10:00,10:30,11:00 (dedup)
    await setWorkingHours(acc, ana.id, [{ weekday: target.weekday, startMinute: H(9), endMinute: H(11) }]);
    await setWorkingHours(acc, bea.id, [{ weekday: target.weekday, startMinute: H(10), endMinute: H(12) }]);

    const slots = await getAvailableSlots(acc, { catalogItemId: svc.id, fromUtc, toUtc });
    expect(localMinutes(slots)).toEqual([H(9), H(9, 30), H(10), H(10, 30), H(11)]);
    // cada horário aparece uma vez só
    expect(new Set(slots.map((s) => s.startISO)).size).toBe(slots.length);
  });

  it("serviço sem duração → erro legível", async () => {
    const acc = await makeOwner();
    const svc = await createCatalogItem(acc, { name: "Consulta", priceCents: 0, kind: "SERVICO", durationMinutes: 0 });
    const { fromUtc, toUtc } = pickTargetDay();
    await expect(
      getAvailableSlots(acc, { catalogItemId: svc.id, fromUtc, toUtc }),
    ).rejects.toThrow(/duração/);
  });

  it("profissional de outra conta → erro", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const foreignPro = await createProfessional(other, { name: "Estranho" });
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 5000, kind: "SERVICO", durationMinutes: 30 });
    const { fromUtc, toUtc } = pickTargetDay();
    await expect(
      getAvailableSlots(acc, { catalogItemId: svc.id, professionalId: foreignPro.id, fromUtc, toUtc }),
    ).rejects.toThrow();
  });

  it("dia sem expediente → sem slots (não erro)", async () => {
    const acc = await makeOwner();
    const pro = await createProfessional(acc, { name: "Ana" });
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 5000, kind: "SERVICO", durationMinutes: 30 });
    const { fromUtc, toUtc } = pickTargetDay();
    // nenhuma WorkingHours cadastrada
    const slots = await getAvailableSlots(acc, { catalogItemId: svc.id, professionalId: pro.id, fromUtc, toUtc });
    expect(slots).toEqual([]);
  });
});

describe("booking-availability.service — confirmBooking", () => {
  beforeEach(() => vi.clearAllMocks());

  /** Conta pronta: profissional c/ expediente 09–12 no dia-alvo + serviço 60min. */
  async function readyAccount() {
    const acc = await makeOwner();
    const pro = await createProfessional(acc, { name: "Ana" });
    const svc = await createCatalogItem(acc, { name: "Corte", priceCents: 5000, kind: "SERVICO", durationMinutes: 60 });
    const { target } = pickTargetDay();
    await setWorkingHours(acc, pro.id, [{ weekday: target.weekday, startMinute: H(9), endMinute: H(12) }]);
    const startISO = zonedWallTimeToUtc(target.year, target.month, target.day, H(10), TZ).toISOString();
    return { acc, pro, svc, target, startISO };
  }

  it("cria Appointment ligado ao lead leve e envia confirmação (conta com chip)", async () => {
    const { acc, pro, svc, startISO } = await readyAccount();
    await makeChip(acc); // há chip → cria lead + confirma

    const res = await confirmBooking(acc, {
      catalogItemId: svc.id,
      professionalId: pro.id,
      startISO,
      customerName: "Cliente Fulano",
      customerPhone: "+5511987654321",
    });

    expect(res.isWalkIn).toBe(false);
    expect(res.leadId).toBeTruthy();
    const appt = await prisma.appointment.findUnique({ where: { id: res.appointmentId } });
    expect(appt?.leadId).toBe(res.leadId);
    expect(appt?.professionalId).toBe(pro.id);
    expect(appt?.scheduledAt.toISOString()).toBe(startISO);
    // lead leve com a origem correta
    const lead = await prisma.lead.findUnique({ where: { id: res.leadId! } });
    expect(lead?.consentSource).toBe("public_booking");
    // confirmação enviada (mock)
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
  });

  it("slot ocupado → CONFLICT e não cria novo agendamento", async () => {
    const { acc, pro, svc, startISO } = await readyAccount();
    // ocupa o slot por dentro
    await createAppointment(acc, {
      customerName: "Já marcado",
      scheduledAt: new Date(startISO),
      professionalId: pro.id,
      durationMinutes: 60,
      createdById: acc,
      force: true,
    });
    const before = await prisma.appointment.count({ where: { professionalId: pro.id } });

    await expect(
      confirmBooking(acc, {
        catalogItemId: svc.id,
        professionalId: pro.id,
        startISO,
        customerName: "Novo",
        customerPhone: "+5511911112222",
      }),
    ).rejects.toThrow(/CONFLICT/);

    const after = await prisma.appointment.count({ where: { professionalId: pro.id } });
    expect(after).toBe(before); // nada criado
  });

  it("fora do horizonte → erro", async () => {
    const { acc, pro, svc } = await readyAccount();
    const far = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(); // 120 dias
    await expect(
      confirmBooking(acc, {
        catalogItemId: svc.id,
        professionalId: pro.id,
        startISO: far,
        customerName: "Zé",
        customerPhone: "+5511933334444",
      }),
    ).rejects.toThrow(/janela/i);
  });

  it("conta sem chip → cria lead solto (vira Cliente) mas SEM confirmação por WhatsApp", async () => {
    const { acc, pro, svc, startISO } = await readyAccount();
    // sem makeChip → conta sem WhatsApp conectado

    const res = await confirmBooking(acc, {
      catalogItemId: svc.id,
      professionalId: pro.id,
      startISO,
      customerName: "Walk Inn",
      customerPhone: "+5511955556666",
    });

    // agora o contato é materializado (aparece em Leads/Clientes)…
    expect(res.isWalkIn).toBe(false);
    expect(res.leadId).toBeTruthy();
    const appt = await prisma.appointment.findUnique({ where: { id: res.appointmentId } });
    expect(appt?.leadId).toBe(res.leadId);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: res.leadId! } });
    expect(lead.whatsAppNumberId).toBeNull(); // solto: sem chip p/ lembrete
    expect(lead.consentSource).toBe("public_booking");
    // …mas sem chip não há por onde mandar a confirmação.
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});

describe("booking-availability.service — confirmBooking anti-corrida", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dois confirmBooking SOBREPOSTOS (horários diferentes) no mesmo profissional: só um entra", async () => {
    const acc = await makeOwner();
    await prisma.user.update({ where: { id: acc }, data: { bookingEnabled: true } });
    const pro = await makeProfessional(acc);
    const item = await createCatalogItem(acc, { name: "Corte 60", priceCents: 5000 });
    await prisma.catalogItem.update({ where: { id: item.id }, data: { durationMinutes: 60 } });

    // Inícios calculados a partir de AGORA (não fixados numa hora do dia, p/ não
    // depender do wall-clock): +3h e +3h30 estão > bookingLeadMinutes=120 e <<
    // horizonte=30d. Serviço de 60 min → [+3h,+4h) x [+3h30,+4h30) se sobrepõem.
    const at = (offsetMin: number) =>
      new Date(Date.now() + 3 * 60 * 60 * 1000 + offsetMin * 60 * 1000).toISOString();
    const mk = (startISO: string) =>
      confirmBooking(acc, {
        catalogItemId: item.id,
        professionalId: pro,
        startISO,
        customerName: "Cliente",
        customerPhone: "+5511999990000",
      });

    const results = await Promise.allSettled([mk(at(0)), mk(at(30))]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason.message).toMatch(/CONFLICT/);

    // E só existe UM agendamento ativo para o profissional
    const count = await prisma.appointment.count({
      where: { professionalId: pro, status: { in: ["AGENDADO", "CONFIRMADO"] } },
    });
    expect(count).toBe(1);
  });
});
