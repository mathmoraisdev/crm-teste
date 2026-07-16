// Integração contra o Postgres local (real prisma). Auditoria da agenda (Tier 2):
// cancelar (operador e IA/cliente), remarcar, trocar profissional.
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createAppointment, cancelAppointment, updateAppointment, applyApptTransition } from "./appointment.service";

async function makeOwner(name = "Dona") {
  const u = await prisma.user.create({
    data: { email: `apptaud_${Math.round(performance.now())}_${Math.random()}@t.test`, name, passwordHash: "x" },
  });
  return u.id;
}
async function makeLead(userId: string, name: string) {
  const l = await prisma.lead.create({ data: { userId, name, phone: `+55119${Math.floor(Math.random() * 1e8)}` } });
  return l.id;
}
async function makeProfessional(userId: string, name = "Prof") {
  const p = await prisma.professional.create({ data: { accountId: userId, name } });
  return p.id;
}

describe("appointment audit", () => {
  it("cancelAppointment (operador) grava APPOINTMENT_CANCEL com o nome do operador", async () => {
    const acc = await makeOwner("Zé");
    const leadId = await makeLead(acc, "Iohuana");
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date("2026-08-05T13:00:00.000Z"), createdById: acc });
    await cancelAppointment(acc, a.id, acc);
    const log = await prisma.auditLog.findFirst({ where: { accountId: acc, action: "APPOINTMENT_CANCEL", entityId: a.id } });
    expect(log?.entityType).toBe("Appointment");
    expect(log?.actorName).toBe("Zé");
    expect(log?.summary).toContain("Iohuana");
  });

  it("applyApptTransition (IA) grava APPOINTMENT_CANCEL com autor IA·Cliente", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "Marcos");
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date("2026-08-06T13:00:00.000Z"), createdById: acc });
    await applyApptTransition(acc, a.id, { status: "CANCELADO", needsReview: true, reviewReason: "Cliente recusou pelo WhatsApp" });
    const log = await prisma.auditLog.findFirst({ where: { accountId: acc, action: "APPOINTMENT_CANCEL", entityId: a.id } });
    expect(log?.actorId).toBe("ia");
    expect(log?.actorName).toBe("IA · Cliente (via WhatsApp)");
    expect(log?.summary).toContain("pedido do cliente");
  });

  it("updateAppointment remarcando grava APPOINTMENT_RESCHEDULE com diff", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "Ana");
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date("2026-08-07T13:00:00.000Z"), createdById: acc });
    const novo = new Date("2026-08-07T16:00:00.000Z");
    await updateAppointment(acc, a.id, { scheduledAt: novo }, acc);
    const log = await prisma.auditLog.findFirst({ where: { accountId: acc, action: "APPOINTMENT_RESCHEDULE", entityId: a.id } });
    expect(log).toBeTruthy();
    expect((log?.diff as any).scheduledAt.to).toBe(novo.toISOString());
  });

  it("updateAppointment trocando profissional grava APPOINTMENT_REASSIGN", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "Bia");
    const prof = await makeProfessional(acc);
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date("2026-08-08T13:00:00.000Z"), createdById: acc });
    await updateAppointment(acc, a.id, { professionalId: prof, force: true, allowOverlap: true }, acc);
    const log = await prisma.auditLog.findFirst({ where: { accountId: acc, action: "APPOINTMENT_REASSIGN", entityId: a.id } });
    expect(log).toBeTruthy();
    expect((log?.diff as any).professionalId.to).toBe(prof);
  });

  it("editar só a nota (sem horário/profissional/cancelamento) NÃO gera log", async () => {
    const acc = await makeOwner();
    const leadId = await makeLead(acc, "Léo");
    const a = await createAppointment(acc, { leadId, scheduledAt: new Date("2026-08-09T13:00:00.000Z"), createdById: acc });
    await updateAppointment(acc, a.id, { note: "cliente pediu café" }, acc);
    const logs = await prisma.auditLog.findMany({ where: { accountId: acc, entityId: a.id } });
    expect(logs).toHaveLength(0);
  });
});
