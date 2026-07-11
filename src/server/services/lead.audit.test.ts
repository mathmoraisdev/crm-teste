// Integração contra o Postgres local (real prisma). Separado de lead.service.test.ts
// de propósito: aquele arquivo faz vi.mock("@/server/db/client"), então não dá p/
// asseverar linhas de AuditLog lá. Mesmo padrão do order.audit.test.ts.
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createLead, deleteLead } from "./lead.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `laudit_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "Dono", passwordHash: "x" },
  });
  return u.id;
}

describe("lead audit", () => {
  it("deleteLead grava AuditLog LEAD_DELETE com snapshot do nome", async () => {
    const a = await makeOwner();
    const lead = await createLead(a, "Fulano", "5511999999999");
    await deleteLead(lead.id, a, a);
    const log = await prisma.auditLog.findFirst({ where: { accountId: a, action: "LEAD_DELETE" } });
    expect(log?.entityId).toBe(lead.id);
    expect(log?.summary).toContain("Fulano");
  });
});
