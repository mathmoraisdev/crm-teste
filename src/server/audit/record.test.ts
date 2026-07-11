import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { recordAudit } from "./record";

async function makeUser(name: string) {
  const u = await prisma.user.create({
    data: { email: `aud_${Math.round(performance.now())}_${Math.random()}@t.test`, name, passwordHash: "x" },
  });
  return u.id;
}

describe("recordAudit", () => {
  it("grava a linha com snapshot do nome do autor, dentro da tx", async () => {
    const owner = await makeUser("Dono");
    const actor = await makeUser("Operador Zé");
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, {
        accountId: owner,
        actorId: actor,
        action: "LEAD_DELETE",
        entityType: "Lead",
        entityId: "lead-123",
        summary: "Excluiu o cliente Fulano",
      });
    });
    const row = await prisma.auditLog.findFirst({ where: { accountId: owner } });
    expect(row?.actorName).toBe("Operador Zé");
    expect(row?.action).toBe("LEAD_DELETE");
    expect(row?.entityId).toBe("lead-123");
    expect(row?.diff).toBeNull();
  });

  // User.name é NOT NULL no schema (schema.prisma:169), então o fallback p/ email
  // por nome-nulo é inalcançável na prática. O fallback REAL é: autor inexistente
  // (id órfão) → grava o próprio actorId. Aqui testamos esse caminho + o diff.
  it("cai no actorId quando o autor não existe e persiste o diff", async () => {
    const owner = await makeUser("Dono2");
    const ghostActorId = `ghost_${Math.round(performance.now())}_${Math.random()}`;
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, {
        accountId: owner, actorId: ghostActorId, action: "CATALOG_PRICE_UPDATE",
        entityType: "CatalogItem", entityId: "it-1", summary: "Mudou preço",
        diff: { priceCents: { from: 2000, to: 2400 } },
      });
    });
    const row = await prisma.auditLog.findFirst({ where: { accountId: owner } });
    expect(row?.actorName).toBe(ghostActorId);
    expect(row?.diff).toEqual({ priceCents: { from: 2000, to: 2400 } });
  });

  it("usa actorName explícito (autor não-humano) sem buscar no User", async () => {
    const owner = await makeUser("Dono3");
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, {
        accountId: owner, actorId: "ia", actorName: "IA · Cliente (via WhatsApp)",
        action: "APPOINTMENT_CANCEL", entityType: "Appointment", entityId: "appt-1",
        summary: "Cancelou o horário — pedido do cliente",
      });
    });
    const row = await prisma.auditLog.findFirst({ where: { accountId: owner } });
    expect(row?.actorId).toBe("ia");
    expect(row?.actorName).toBe("IA · Cliente (via WhatsApp)");
    expect(row?.action).toBe("APPOINTMENT_CANCEL");
  });
});
