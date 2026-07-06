import { describe, it, expect } from "vitest";
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
} from "./booking-availability.service";

const TZ = env.SCHEDULING_TIMEZONE;
const DAY_MS = 24 * 60 * 60 * 1000;

async function makeOwner() {
  const u = await prisma.user.create({
    data: {
      email: `bavail_${Math.round(performance.now())}_${Math.random()}@t.test`,
      name: "Dono",
      passwordHash: "x",
      bookingSlotStep: 30, // grade de 30min p/ asserções limpas
    },
  });
  return u.id;
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
