import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: {
    tag: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    lead: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

describe("createTag", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita nome duplicado (P2002 → mensagem amigável)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.tag.create as any).mockRejectedValue({ code: "P2002" });
    const { createTag } = await import("./tag.service");
    await expect(createTag("dono-1", "VIP", "blue")).rejects.toThrow(/já existe/i);
  });

  it("rejeita cor inválida sem tocar o banco", async () => {
    const { prisma } = await import("@/server/db/client");
    const { createTag } = await import("./tag.service");
    await expect(createTag("dono-1", "VIP", "rosa-choque")).rejects.toThrow(/cor inválida/i);
    expect(prisma.tag.create).not.toHaveBeenCalled();
  });
});

describe("setLeadTags", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita tag de outra conta", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead-1" });
    // Pediu 2 tags mas só 1 pertence ao dono → posse não confere.
    (prisma.tag.findMany as any).mockResolvedValue([{ id: "t1" }]);
    const { setLeadTags } = await import("./tag.service");
    await expect(setLeadTags("dono-1", "lead-1", ["t1", "t2"])).rejects.toThrow(/não pertencem/i);
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it("rejeita lead de outra conta", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue(null);
    const { setLeadTags } = await import("./tag.service");
    await expect(setLeadTags("dono-1", "lead-de-outro", ["t1"])).rejects.toThrow(/não encontrado/i);
  });

  it("grava o set quando posse confere", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue({ id: "lead-1" });
    (prisma.tag.findMany as any).mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    (prisma.lead.update as any).mockResolvedValue({ id: "lead-1" });
    const { setLeadTags } = await import("./tag.service");
    await setLeadTags("dono-1", "lead-1", ["t1", "t2"]);
    const arg = (prisma.lead.update as any).mock.calls[0][0];
    expect(arg.data.tags.set).toEqual([{ id: "t1" }, { id: "t2" }]);
  });
});
