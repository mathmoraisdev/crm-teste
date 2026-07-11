import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { recordAudit } from "@/server/audit/record";
import { listAudit } from "./audit.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `audsvc_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "Dono", passwordHash: "x" },
  });
  return u.id;
}

describe("listAudit", () => {
  it("filtra por conta, entityType e pagina por createdAt desc", async () => {
    const owner = await makeOwner();
    const other = await makeOwner();
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, { accountId: owner, actorId: owner, action: "LEAD_DELETE", entityType: "Lead", entityId: "l1", summary: "a" });
      await recordAudit(tx, { accountId: owner, actorId: owner, action: "ORDER_VOID", entityType: "Order", entityId: "o1", summary: "b" });
      await recordAudit(tx, { accountId: other, actorId: other, action: "LEAD_DELETE", entityType: "Lead", entityId: "l2", summary: "c" });
    });
    const all = await listAudit(owner, {});
    expect(all.items).toHaveLength(2); // não vaza a outra conta
    const onlyLeads = await listAudit(owner, { entityType: "Lead" });
    expect(onlyLeads.items.map((i) => i.entityId)).toEqual(["l1"]);
  });

  it("pagina com cursor (take + nextCursor)", async () => {
    const owner = await makeOwner();
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < 3; i++) {
        await recordAudit(tx, { accountId: owner, actorId: owner, action: "LEAD_DELETE", entityType: "Lead", entityId: `p${i}`, summary: `s${i}` });
      }
    });
    const page1 = await listAudit(owner, { take: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listAudit(owner, { take: 2, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });
});
