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
  decideApptTransition,
  applyApptTransition,
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
async function makeProfessional(userId: string, name = "Profissional") {
  const p = await prisma.professional.create({ data: { accountId: userId, name } });
  return p.id;
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

  // A ação manual da equipe no card (Confirmar/Cancelar/Realizado/Faltou) = revisão
  // feita → tem de zerar needsReview, senão o badge da Agenda nunca baixa.
  it("markRealized zera needsReview", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000010");
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date(), createdById: acc });
    await applyApptTransition(acc, a.id, { status: "CONFIRMADO", needsReview: true, reviewReason: "x" });
    const updated = await markRealized(acc, a.id);
    expect(updated.needsReview).toBe(false);
    expect(updated.reviewReason).toBeNull();
  });

  it("cancelAppointment zera needsReview", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000011");
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date(), createdById: acc });
    await applyApptTransition(acc, a.id, { status: null, needsReview: true, reviewReason: "x" });
    const updated = await cancelAppointment(acc, a.id);
    expect(updated.status).toBe("CANCELADO");
    expect(updated.needsReview).toBe(false);
    expect(updated.reviewReason).toBeNull();
  });

  it("updateAppointment com status manual zera needsReview", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900000012");
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date(), createdById: acc });
    await applyApptTransition(acc, a.id, { status: null, needsReview: true, reviewReason: "x" });
    const updated = await updateAppointment(acc, a.id, { status: "FALTOU" });
    expect(updated.status).toBe("FALTOU");
    expect(updated.needsReview).toBe(false);
    expect(updated.reviewReason).toBeNull();
  });

  it("snapshota a duração do item do catálogo no agendamento", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900020001");
    const item = await createCatalogItem(acc, { name: "Massagem", priceCents: 10000 });
    await prisma.catalogItem.update({ where: { id: item.id }, data: { durationMinutes: 60 } });

    const appt = await createAppointment(acc, {
      leadId,
      scheduledAt: new Date("2026-08-01T14:00:00.000Z"),
      catalogItemId: item.id,
      createdById: acc,
    });
    expect(appt.durationMinutes).toBe(60);
    // duração explícita tem precedência sobre a do item
    const appt2 = await createAppointment(acc, {
      leadId,
      scheduledAt: new Date("2026-08-01T16:00:00.000Z"),
      catalogItemId: item.id,
      durationMinutes: 30,
      createdById: acc,
    });
    expect(appt2.durationMinutes).toBe(30);
  });

  it("bloqueia conflito do mesmo profissional e allowOverlap libera", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900020002");
    const pro = await makeProfessional(acc);
    await createAppointment(acc, {
      leadId,
      scheduledAt: new Date("2026-08-02T14:00:00.000Z"),
      durationMinutes: 60,
      professionalId: pro,
      createdById: acc,
    });
    // começa 30min depois → sobrepõe [14:00,15:00)
    const at2 = new Date("2026-08-02T14:30:00.000Z");
    await expect(
      createAppointment(acc, { leadId, scheduledAt: at2, durationMinutes: 60, professionalId: pro, createdById: acc }),
    ).rejects.toThrow(/CONFLICT/);
    // override explícito passa
    const ok = await createAppointment(acc, {
      leadId,
      scheduledAt: at2,
      durationMinutes: 60,
      professionalId: pro,
      allowOverlap: true,
      createdById: acc,
    });
    expect(ok.id).toBeTruthy();
  });

  it("mesmo horário com OUTRO profissional não conflita", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900020003");
    const p1 = await makeProfessional(acc, "A");
    const p2 = await makeProfessional(acc, "B");
    const at = new Date("2026-08-03T14:00:00.000Z");
    await createAppointment(acc, { leadId, scheduledAt: at, durationMinutes: 60, professionalId: p1, createdById: acc });
    const ok = await createAppointment(acc, {
      leadId,
      scheduledAt: at,
      durationMinutes: 60,
      professionalId: p2,
      createdById: acc,
    });
    expect(ok.professionalId).toBe(p2);
  });

  it("encostar nas bordas NÃO é conflito (fim exclusivo)", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900020004");
    const pro = await makeProfessional(acc);
    await createAppointment(acc, {
      leadId,
      scheduledAt: new Date("2026-08-04T14:00:00.000Z"),
      durationMinutes: 60,
      professionalId: pro,
      createdById: acc,
    });
    // começa exatamente às 15:00 (fim do anterior) → só toca a borda
    const ok = await createAppointment(acc, {
      leadId,
      scheduledAt: new Date("2026-08-04T15:00:00.000Z"),
      durationMinutes: 60,
      professionalId: pro,
      createdById: acc,
    });
    expect(ok.id).toBeTruthy();
  });

  it("cria walk-in sem lead (escopo por accountId) e aparece na lista", async () => {
    const acc = await makeOwner();
    const appt = await createAppointment(acc, {
      customerName: "Fulano de Tal",
      customerPhone: "+5511911112222",
      scheduledAt: new Date("2026-08-05T10:00:00.000Z"),
      createdById: acc,
    });
    expect(appt.leadId).toBeNull();
    expect(appt.accountId).toBe(acc);
    expect(appt.customerName).toBe("Fulano de Tal");

    const list = await listAppointments(acc, {
      from: new Date("2026-08-05T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
    });
    const found = list.find((a) => a.id === appt.id);
    expect(found).toBeTruthy();
    expect(found?.lead).toBeNull();
    expect(found?.customerName).toBe("Fulano de Tal");
  });

  it("walk-in sem nome do cliente é rejeitado", async () => {
    const acc = await makeOwner();
    await expect(
      createAppointment(acc, { scheduledAt: new Date("2026-08-05T11:00:00.000Z"), createdById: acc }),
    ).rejects.toThrow(/nome do cliente/i);
  });

  it("listAppointments filtra por profissional", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "+5511900020006");
    const p1 = await makeProfessional(acc, "A");
    const p2 = await makeProfessional(acc, "B");
    await createAppointment(acc, {
      leadId,
      scheduledAt: new Date("2026-08-06T10:00:00.000Z"),
      professionalId: p1,
      createdById: acc,
    });
    await createAppointment(acc, {
      leadId,
      scheduledAt: new Date("2026-08-06T12:00:00.000Z"),
      professionalId: p2,
      createdById: acc,
    });
    const onlyP1 = await listAppointments(acc, { leadId, professionalId: p1 });
    expect(onlyP1).toHaveLength(1);
    expect(onlyP1[0].professionalId).toBe(p1);
  });
});

describe("decideApptTransition", () => {
  it("confirm confiante → CONFIRMADO + revisão", () => {
    expect(decideApptTransition({ intent: "confirm", confident: true })).toEqual({
      status: "CONFIRMADO",
      needsReview: true,
      reviewReason: "Cliente confirmou pelo WhatsApp",
    });
  });
  it("decline confiante → CANCELADO + revisão", () => {
    expect(decideApptTransition({ intent: "decline", confident: true })).toEqual({
      status: "CANCELADO",
      needsReview: true,
      reviewReason: "Cliente recusou/desmarcou pelo WhatsApp",
    });
  });
  it("reschedule → sem mudar status, só sinaliza", () => {
    expect(decideApptTransition({ intent: "reschedule", confident: true })).toEqual({
      status: null,
      needsReview: true,
      reviewReason: "Cliente pediu para remarcar",
    });
  });
  it("não-confiante → nunca muda status, só sinaliza revisão", () => {
    expect(decideApptTransition({ intent: "confirm", confident: false })).toEqual({
      status: null,
      needsReview: true,
      reviewReason: "Resposta ambígua ao lembrete — conferir",
    });
  });
  it("unclear → nenhuma ação (null total)", () => {
    expect(decideApptTransition({ intent: "unclear", confident: true })).toBeNull();
  });
});
