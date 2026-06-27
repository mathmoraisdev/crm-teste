import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: {
    customFieldDef: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

describe("mergeCustomFields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita key inexistente", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.customFieldDef.findMany as any).mockResolvedValue([]);
    const { mergeCustomFields } = await import("./custom-field.service");
    await expect(mergeCustomFields("dono-1", null, { fantasma: "x" })).rejects.toThrow(/desconhecido/i);
  });

  it("rejeita valor que não casa o tipo NUMBER", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.customFieldDef.findMany as any).mockResolvedValue([
      { key: "idade", type: "NUMBER", options: null, label: "Idade" },
    ]);
    const { mergeCustomFields } = await import("./custom-field.service");
    await expect(mergeCustomFields("dono-1", null, { idade: "abc" })).rejects.toThrow(/número/i);
  });

  it("mescla raso e remove chave com valor vazio", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.customFieldDef.findMany as any).mockResolvedValue([
      { key: "cidade", type: "TEXT", options: null, label: "Cidade" },
      { key: "vip", type: "BOOLEAN", options: null, label: "VIP" },
    ]);
    const { mergeCustomFields } = await import("./custom-field.service");
    const out = await mergeCustomFields("dono-1", { cidade: "SP", vip: true }, { cidade: "", vip: false });
    expect(out).toEqual({ vip: false }); // cidade removida; vip atualizado
  });

  it("valida opção de SELECT", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.customFieldDef.findMany as any).mockResolvedValue([
      { key: "plano", type: "SELECT", options: ["A", "B"], label: "Plano" },
    ]);
    const { mergeCustomFields } = await import("./custom-field.service");
    await expect(mergeCustomFields("dono-1", null, { plano: "C" })).rejects.toThrow(/inválido/i);
    const ok = await mergeCustomFields("dono-1", null, { plano: "A" });
    expect(ok).toEqual({ plano: "A" });
  });
});
