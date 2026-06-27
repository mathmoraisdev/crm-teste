import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.ADMIN_EMAILS = "admin@exemplo.com";
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    whatsAppNumber: { findUnique: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
// dispatcher é importado pelo service; stub p/ não puxar dependências de runtime.
vi.mock("@/server/worker/dispatcher", () => ({ sentTodayByNumber: vi.fn() }));

describe("assertNumberQuota", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bloqueia ao atingir o teto do plano (INICIAL: 1 número)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "INICIAL" });
    (prisma.whatsAppNumber.findUnique as any).mockResolvedValue(null); // número novo
    (prisma.whatsAppNumber.count as any).mockResolvedValue(1); // já tem 1 (= maxNumbers)
    const { assertNumberQuota } = await import("./numbers.service");
    await expect(assertNumberQuota("dono-1", "+5511999999999")).rejects.toThrow(/plano permite/i);
  });

  it("permite abaixo do teto (PROFISSIONAL: 1 de 2)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "PROFISSIONAL" });
    (prisma.whatsAppNumber.findUnique as any).mockResolvedValue(null);
    (prisma.whatsAppNumber.count as any).mockResolvedValue(1);
    const { assertNumberQuota } = await import("./numbers.service");
    await expect(assertNumberQuota("dono-1", "+5511999999999")).resolves.toBeUndefined();
  });

  it("re-pareamento de número existente não conta como novo (permite no teto)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: "INICIAL" });
    (prisma.whatsAppNumber.findUnique as any).mockResolvedValue({ id: "n-1" }); // já existe esse phone
    (prisma.whatsAppNumber.count as any).mockResolvedValue(1);
    const { assertNumberQuota } = await import("./numbers.service");
    await expect(assertNumberQuota("dono-1", "+5511999999999")).resolves.toBeUndefined();
    expect(prisma.whatsAppNumber.count).not.toHaveBeenCalled();
  });

  it("plano null não aplica limite (grandfather)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "cli@x.com", plan: null });
    const { assertNumberQuota } = await import("./numbers.service");
    await expect(assertNumberQuota("dono-1", "+5511999999999")).resolves.toBeUndefined();
    expect(prisma.whatsAppNumber.count).not.toHaveBeenCalled();
  });

  it("admin da plataforma não tem limite", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ email: "admin@exemplo.com", plan: "INICIAL" });
    const { assertNumberQuota } = await import("./numbers.service");
    await expect(assertNumberQuota("admin-1", "+5511999999999")).resolves.toBeUndefined();
    expect(prisma.whatsAppNumber.count).not.toHaveBeenCalled();
  });
});
