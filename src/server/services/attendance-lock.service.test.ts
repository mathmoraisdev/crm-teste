import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { updateMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/server/events/bus", () => ({ publishTenantEvent: vi.fn().mockResolvedValue(undefined) }));

async function mods() {
  return {
    prisma: (await import("@/server/db/client")).prisma as any,
    publish: (await import("@/server/events/bus")).publishTenantEvent as any,
    svc: await import("./attendance-lock.service"),
  };
}

beforeEach(() => vi.clearAllMocks());

const NOW = new Date("2026-07-08T12:00:00.000Z");

describe("claimConversation", () => {
  it("livre (ou já minha) → reivindica e publica", async () => {
    const m = await mods();
    m.prisma.lead.updateMany.mockResolvedValue({ count: 1 }); // conseguiu a trava
    const r = await m.svc.claimConversation({
      leadId: "L1", tenantUserId: "T", userId: "ana", now: NOW,
    });
    expect(m.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: "L1", OR: [{ attendingUserId: null }, { attendingUserId: "ana" }] },
      data: { attendingUserId: "ana", attendingAt: NOW },
    });
    expect(r).toEqual({ ok: true, heldBy: null });
    expect(m.publish).toHaveBeenCalledWith("T", { type: "conversation:changed", leadId: "L1" });
  });

  it("ocupada por outro → NÃO rouba, devolve quem segura", async () => {
    const m = await mods();
    m.prisma.lead.updateMany.mockResolvedValue({ count: 0 }); // não conseguiu
    m.prisma.lead.findFirst.mockResolvedValue({
      attendingUserId: "beto", attendingAt: NOW, attendingTo: { id: "beto", name: "Beto" },
    });
    const r = await m.svc.claimConversation({
      leadId: "L1", tenantUserId: "T", userId: "ana", now: NOW,
    });
    expect(m.prisma.lead.update).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, heldBy: { userId: "beto", name: "Beto", since: NOW } });
    expect(m.publish).not.toHaveBeenCalled(); // nada mudou
  });
});

describe("takeoverConversation", () => {
  it("assume à força e publica (o anterior recebe o evento)", async () => {
    const m = await mods();
    m.prisma.lead.update.mockResolvedValue({});
    await m.svc.takeoverConversation({ leadId: "L1", tenantUserId: "T", userId: "ana", now: NOW });
    expect(m.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: "L1" },
      data: { attendingUserId: "ana", attendingAt: NOW },
    });
    expect(m.publish).toHaveBeenCalledWith("T", { type: "conversation:changed", leadId: "L1" });
  });
});

describe("releaseConversation", () => {
  it("libera SÓ se eu ainda seguro (não apaga trava de quem assumiu)", async () => {
    const m = await mods();
    m.prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    await m.svc.releaseConversation({ leadId: "L1", tenantUserId: "T", userId: "ana" });
    expect(m.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: "L1", attendingUserId: "ana" },
      data: { attendingUserId: null, attendingAt: null },
    });
    expect(m.publish).toHaveBeenCalledWith("T", { type: "conversation:changed", leadId: "L1" });
  });

  it("já não era minha (outro assumiu) → count 0, não publica", async () => {
    const m = await mods();
    m.prisma.lead.updateMany.mockResolvedValue({ count: 0 });
    await m.svc.releaseConversation({ leadId: "L1", tenantUserId: "T", userId: "ana" });
    expect(m.publish).not.toHaveBeenCalled();
  });
});
