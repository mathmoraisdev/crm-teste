import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://t:t@localhost:5432/t?schema=public";
});
vi.mock("@/server/db/client", () => ({
  prisma: { modifierGroup: { findMany: vi.fn() } },
}));

const GROUPS = [
  { id: "g1", name: "Tamanho", minSelect: 1, maxSelect: 1, sortOrder: 0,
    options: [
      { id: "o1", name: "Média", priceDeltaCents: 0, active: true, sortOrder: 0 },
      { id: "o2", name: "Grande", priceDeltaCents: 800, active: true, sortOrder: 1 },
    ] },
  { id: "g2", name: "Adicionais", minSelect: 0, maxSelect: 3, sortOrder: 1,
    options: [
      { id: "o3", name: "Bacon", priceDeltaCents: 500, active: true, sortOrder: 0 },
      { id: "o4", name: "Cheddar", priceDeltaCents: 400, active: true, sortOrder: 1 },
      { id: "o5", name: "Fora de linha", priceDeltaCents: 100, active: false, sortOrder: 2 },
    ] },
];

describe("resolveModifierSelection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@/server/db/client");
    (prisma.modifierGroup.findMany as any).mockResolvedValue(GROUPS);
  });

  it("soma os deltas e monta o snapshot na ordem dos grupos", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    const r = await resolveModifierSelection("acc", "item", ["o2", "o3"]);
    expect(r.deltaCents).toBe(1300);
    expect(r.snapshot).toEqual([
      { groupName: "Tamanho", optionName: "Grande", priceDeltaCents: 800 },
      { groupName: "Adicionais", optionName: "Bacon", priceDeltaCents: 500 },
    ]);
  });

  it("sem seleção e sem grupos obrigatórios → delta 0, snapshot null", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.modifierGroup.findMany as any).mockResolvedValue([]);
    const { resolveModifierSelection } = await import("./modifier.service");
    const r = await resolveModifierSelection("acc", "item", []);
    expect(r.deltaCents).toBe(0);
    expect(r.snapshot).toBeNull();
  });

  it("grupo obrigatório sem escolha → erro", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    await expect(resolveModifierSelection("acc", "item", [])).rejects.toThrow(/Tamanho/);
  });

  it("acima do maxSelect → erro", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    await expect(resolveModifierSelection("acc", "item", ["o1", "o2"])).rejects.toThrow(/Tamanho/);
  });

  it("opção inativa → erro", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    await expect(resolveModifierSelection("acc", "item", ["o1", "o5"])).rejects.toThrow(/indisponível/i);
  });

  it("opção que não é do item → erro", async () => {
    const { resolveModifierSelection } = await import("./modifier.service");
    await expect(resolveModifierSelection("acc", "item", ["o1", "xxx"])).rejects.toThrow(/inválid/i);
  });
});
