// Integração contra o Postgres local (real prisma). inbox.service.test.ts faz
// vi.mock do client, então a asserção de AuditLog vive aqui (padrão order.audit.test.ts).
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createLead } from "./lead.service";
import { assignConversation } from "./inbox.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `iaudit_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "Dono", passwordHash: "x" },
  });
  return u.id;
}

async function makeOperator(ownerId: string, name: string) {
  const u = await prisma.user.create({
    data: { email: `iop_${Math.round(performance.now())}_${Math.random()}@t.test`, name, passwordHash: "x", role: "OPERADOR", ownerId },
  });
  return u.id;
}

describe("inbox audit", () => {
  it("assignConversation grava LEAD_REASSIGN com diff from→to", async () => {
    const owner = await makeOwner();
    const opX = await makeOperator(owner, "Op X");
    const opY = await makeOperator(owner, "Op Y");
    const lead = await createLead(owner, "Cliente", "5511988887777");
    // primeiro atribui a X (autor = dono)
    await assignConversation(owner, lead.id, opX, owner);
    // reatribui a Y (autor = dono)
    await assignConversation(owner, lead.id, opY, owner);

    const logs = await prisma.auditLog.findMany({
      where: { accountId: owner, action: "LEAD_REASSIGN", entityId: lead.id },
      orderBy: { createdAt: "asc" },
    });
    // duas reatribuições: null→X e X→Y
    expect(logs).toHaveLength(2);
    const last = logs[1];
    expect((last.diff as any).assignedToId.from).toBe(opX);
    expect((last.diff as any).assignedToId.to).toBe(opY);
    expect(last.summary).toContain("Cliente");
  });

  it("reassumir para o MESMO operador não gera log", async () => {
    const owner = await makeOwner();
    const opX = await makeOperator(owner, "Op X");
    const lead = await createLead(owner, "Cliente", "5511977776666");
    await assignConversation(owner, lead.id, opX, owner);
    await assignConversation(owner, lead.id, opX, owner); // mesmo destino
    const logs = await prisma.auditLog.findMany({
      where: { accountId: owner, action: "LEAD_REASSIGN", entityId: lead.id },
    });
    expect(logs).toHaveLength(1); // só a 1ª (null→X); a 2ª (X→X) não audita
  });
});
