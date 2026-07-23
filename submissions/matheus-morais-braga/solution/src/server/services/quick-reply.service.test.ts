import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import {
  createQuickReply,
  listQuickReplies,
  updateQuickReply,
  deleteQuickReply,
} from "./quick-reply.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `qr_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("quick-reply.service", () => {
  it("cria e lista escopado por conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await createQuickReply(a, { title: "Saudação", body: "Olá {{nome}}", shortcut: "oi" });
    await createQuickReply(b, { title: "Outra", body: "Tchau" });
    const listA = await listQuickReplies(a);
    expect(listA).toHaveLength(1);
    expect(listA[0].title).toBe("Saudação");
    expect(listA[0].shortcut).toBe("oi");
  });

  it("rejeita título ou corpo vazios", async () => {
    const a = await makeOwner();
    await expect(createQuickReply(a, { title: "  ", body: "x" })).rejects.toThrow();
    await expect(createQuickReply(a, { title: "x", body: "  " })).rejects.toThrow();
  });

  it("normaliza o atalho (sem barra, minúsculo)", async () => {
    const a = await makeOwner();
    const qr = await createQuickReply(a, { title: "T", body: "B", shortcut: "/OI" });
    expect(qr.shortcut).toBe("oi");
  });

  it("atalho é único por conta, mas coexiste entre contas", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await createQuickReply(a, { title: "A", body: "B", shortcut: "oi" });
    await expect(createQuickReply(a, { title: "A2", body: "B2", shortcut: "oi" })).rejects.toThrow();
    // outra conta pode ter o mesmo atalho
    await expect(createQuickReply(b, { title: "B1", body: "B", shortcut: "oi" })).resolves.toBeTruthy();
  });

  it("update só afeta item da própria conta e checa atalho", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const qr = await createQuickReply(a, { title: "T", body: "B" });
    await createQuickReply(a, { title: "Outra", body: "B", shortcut: "ja" });
    await expect(updateQuickReply(b, qr.id, { title: "hack" })).rejects.toThrow();
    await expect(updateQuickReply(a, qr.id, { shortcut: "ja" })).rejects.toThrow(); // colide
    const upd = await updateQuickReply(a, qr.id, { title: "Novo", shortcut: "livre" });
    expect(upd.title).toBe("Novo");
    expect(upd.shortcut).toBe("livre");
  });

  it("delete remove o item", async () => {
    const a = await makeOwner();
    const qr = await createQuickReply(a, { title: "T", body: "B" });
    await deleteQuickReply(a, qr.id);
    expect(await listQuickReplies(a)).toHaveLength(0);
  });
});
