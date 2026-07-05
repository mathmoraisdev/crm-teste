import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import {
  createAppointment,
  createSeries,
  listAppointments,
  cancelAppointment,
  markRealized,
  updateAppointment,
} from "./appointment.service";
import { openOrder } from "./order.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `appt_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}
async function makeLead(userId: string, phone: string) {
  const l = await prisma.lead.create({ data: { userId, name: "Cliente", phone } });
  return l.id;
}

describe("appointment.service", () => {
  it("cria agendamento e snapshota o nome do serviço do catálogo", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000001");
    const item = await createCatalogItem(acc, { name: "Depilação a laser", priceCents: 15000 });

    const appt = await createAppointment(acc, {
      leadId,
      scheduledAt: new Date("2026-08-01T14:00:00.000Z"),
      catalogItemId: item.id,
      createdById: acc,
    });
    expect(appt.serviceName).toBe("Depilação a laser"); // snapshot
    expect(appt.status).toBe("AGENDADO");

    // snapshot sobrevive à renomeação do item
    await prisma.catalogItem.update({ where: { id: item.id }, data: { name: "Outro nome" } });
    const [listed] = await listAppointments(acc, { leadId });
    expect(listed.serviceName).toBe("Depilação a laser");
  });

  it("createSeries gera N sessões com o mesmo seriesId e datas espaçadas", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000002");
    const start = new Date("2026-08-01T14:00:00.000Z");

    const { seriesId, count } = await createSeries(
      acc,
      { leadId, scheduledAt: start, serviceName: "Sessão", createdById: acc },
      { everyDays: 7, count: 4 },
    );
    expect(count).toBe(4);

    const list = await listAppointments(acc, { leadId });
    expect(list).toHaveLength(4);
    expect(list.every((a) => a.seriesId === seriesId)).toBe(true);
    // 7 dias entre a 1ª e a 2ª
    const diff = list[1].scheduledAt.getTime() - list[0].scheduledAt.getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("rejeita agendar em lead de outro dono", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000003");
    await expect(
      createAppointment(other, { leadId, scheduledAt: new Date(), createdById: other }),
    ).rejects.toThrow();
  });

  it("listAppointments filtra por janela e não vaza entre donos", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000004");
    await createAppointment(acc, {
      leadId,
      scheduledAt: new Date("2026-09-10T10:00:00.000Z"),
      createdById: acc,
    });
    // outro dono não enxerga
    expect(await listAppointments(other, {})).toHaveLength(0);
    // janela que exclui a data → vazio
    expect(
      await listAppointments(acc, { from: new Date("2026-09-11T00:00:00.000Z") }),
    ).toHaveLength(0);
    // janela que inclui → 1
    expect(
      await listAppointments(acc, { from: new Date("2026-09-01T00:00:00.000Z") }),
    ).toHaveLength(1);
  });

  it("cancelAppointment e markRealized mudam o status", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000005");
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date(), createdById: acc });
    expect((await cancelAppointment(acc, a.id)).status).toBe("CANCELADO");

    const b = await createAppointment(acc, { leadId, scheduledAt: new Date(), createdById: acc });
    expect((await markRealized(acc, b.id)).status).toBe("REALIZADO");
  });

  it("renomear só o serviceName NÃO desvincula o item do catálogo", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000006");
    const item = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date(), catalogItemId: item.id, createdById: acc });

    const upd = await updateAppointment(acc, a.id, { serviceName: "Corte masculino" });
    expect(upd.serviceName).toBe("Corte masculino");
    expect(upd.catalogItemId).toBe(item.id); // vínculo preservado
  });

  it("aplica status + nota juntos no mesmo update (REALIZADO não descarta os outros campos)", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000007");
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date(), createdById: acc });
    const upd = await updateAppointment(acc, a.id, { status: "REALIZADO", note: "cobrado" });
    expect(upd.status).toBe("REALIZADO");
    expect(upd.note).toBe("cobrado"); // não foi descartado
  });

  it("rejeita vincular comanda de outro dono (orderId cross-tenant)", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000008");
    const otherLeadId = (await prisma.lead.create({ data: { userId: other, name: "X", phone: "+5511900000009" } })).id;
    const otherOrder = await openOrder(other, { openedById: other, leadId: otherLeadId });
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date(), createdById: acc });
    await expect(markRealized(acc, a.id, { orderId: otherOrder.id })).rejects.toThrow();
    await expect(updateAppointment(acc, a.id, { orderId: otherOrder.id })).rejects.toThrow();
  });
});
