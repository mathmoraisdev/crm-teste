import { describe, it, expect, vi, beforeEach } from "vitest";

// conversation.service importa a cadeia de IA → env.ts, que exige DATABASE_URL.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

vi.mock("@/server/db/client", () => ({
  prisma: { lead: { findFirst: vi.fn() } },
}));

describe("resolveLead — isolamento de tenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem whatsAppNumberId e sem userId, NÃO busca global por telefone (retorna null)", async () => {
    const { prisma } = await import("@/server/db/client");
    const { resolveLead } = await import("./conversation.service");
    const result = await resolveLead({ phone: "+5511999999999", text: "oi" });
    expect(result).toBeNull();
    // Não pode ter consultado o banco com filtro só de telefone.
    expect(prisma.lead.findFirst as any).not.toHaveBeenCalled();
  });
});
