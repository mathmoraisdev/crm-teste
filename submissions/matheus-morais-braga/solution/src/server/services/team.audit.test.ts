// Integração contra o Postgres local (real prisma). team.service.test.ts faz
// vi.mock do client, então a asserção de AuditLog vive aqui (padrão order.audit.test.ts).
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { updateOperatorPerms } from "./team.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `taudit_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "Dono", passwordHash: "x" },
  });
  return u.id;
}

async function makeOperator(ownerId: string, over: Record<string, unknown> = {}) {
  const u = await prisma.user.create({
    data: {
      email: `tsop_${Math.round(performance.now())}_${Math.random()}@t.test`,
      name: "Operador", passwordHash: "x", role: "OPERADOR", ownerId, ...over,
    },
  });
  return u.id;
}

describe("team audit (OPERATOR_PERMS_UPDATE)", () => {
  it("grava AuditLog com diff quando muda uma permissão", async () => {
    const owner = await makeOwner();
    const opId = await makeOperator(owner, { canFinance: true });
    await updateOperatorPerms(owner, opId, { canFinance: false }, owner);

    const log = await prisma.auditLog.findFirst({
      where: { accountId: owner, action: "OPERATOR_PERMS_UPDATE", entityId: opId },
    });
    expect(log).toBeTruthy();
    expect(log?.entityType).toBe("User");
    expect((log?.diff as any).canFinance).toEqual({ from: true, to: false });
    expect(log?.summary).toContain("Operador");
  });

  it("salvar a mesma permissão (sem mudança) NÃO gera log", async () => {
    const owner = await makeOwner();
    const opId = await makeOperator(owner, { canFinance: false });
    await updateOperatorPerms(owner, opId, { canFinance: false }, owner); // já era false
    const log = await prisma.auditLog.findFirst({
      where: { accountId: owner, action: "OPERATOR_PERMS_UPDATE", entityId: opId },
    });
    expect(log).toBeNull();
  });
});
