import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => {
  const tx = {
    order: { updateMany: vi.fn() },
    expense: { updateMany: vi.fn() },
    recurringExpense: { updateMany: vi.fn() },
    stockMovement: { updateMany: vi.fn() },
    user: { delete: vi.fn() },
  };
  return {
    prisma: {
      user: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
      // $transaction executa o callback com o tx mockado (mesmas instâncias em __tx).
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
      __tx: tx,
    },
  };
});

// Admin record helper (o que createOperator carrega por id).
function adminRecord(over: Record<string, unknown> = {}) {
  return { id: "dono-1", ownerId: null, role: "ADMIN", plan: "PROFISSIONAL", ...over };
}

describe("createOperator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita quando o chamador é OPERADOR", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockImplementation(({ where }: any) =>
      where.id ? Promise.resolve(adminRecord({ id: "op-1", ownerId: "dono-1", role: "OPERADOR" })) : Promise.resolve(null),
    );
    const { createOperator } = await import("./team.service");
    await expect(
      createOperator("op-1", { name: "X", email: "x@y.com", password: "12345678" }),
    ).rejects.toThrow(/apenas o administrador/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejeita quando o dono não tem plano definido", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockImplementation(({ where }: any) =>
      where.id ? Promise.resolve(adminRecord({ plan: null })) : Promise.resolve(null),
    );
    const { createOperator } = await import("./team.service");
    await expect(
      createOperator("dono-1", { name: "X", email: "x@y.com", password: "12345678" }),
    ).rejects.toThrow(/defina um plano/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejeita ao estourar o teto de seats (INICIAL: dono + 1 já ocupa 2)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockImplementation(({ where }: any) =>
      where.id ? Promise.resolve(adminRecord({ plan: "INICIAL" })) : Promise.resolve(null),
    );
    (prisma.user.count as any).mockResolvedValue(2); // maxSeats INICIAL = 2
    const { createOperator } = await import("./team.service");
    await expect(
      createOperator("dono-1", { name: "X", email: "x@y.com", password: "12345678" }),
    ).rejects.toThrow(/limite/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejeita e-mail já existente", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockImplementation(({ where }: any) =>
      where.id ? Promise.resolve(adminRecord()) : Promise.resolve({ id: "outro" }),
    );
    (prisma.user.count as any).mockResolvedValue(1);
    const { createOperator } = await import("./team.service");
    await expect(
      createOperator("dono-1", { name: "X", email: "x@y.com", password: "12345678" }),
    ).rejects.toThrow(/já existe/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("cria operador (PROFISSIONAL, 1 seat usado) com ownerId/role/hash", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockImplementation(({ where }: any) =>
      where.id ? Promise.resolve(adminRecord()) : Promise.resolve(null),
    );
    (prisma.user.count as any).mockResolvedValue(1);
    (prisma.user.create as any).mockResolvedValue({ id: "op-novo" });
    const { createOperator } = await import("./team.service");
    const res = await createOperator("dono-1", { name: "  Maria  ", email: "Maria@Y.com", password: "12345678" });
    expect(res).toEqual({ id: "op-novo" });
    const arg = (prisma.user.create as any).mock.calls[0][0];
    expect(arg.data).toMatchObject({
      name: "Maria",
      email: "maria@y.com",
      ownerId: "dono-1",
      role: "OPERADOR",
      canFinance: true, // default = acesso total (igual às demais flags) quando omitido
    });
    expect(arg.data.passwordHash).toMatch(/^scrypt\$/);
    expect(arg.data).not.toHaveProperty("plan");
  });

  it("grava canFinance=false quando informado", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockImplementation(({ where }: any) =>
      where.id ? Promise.resolve(adminRecord()) : Promise.resolve(null),
    );
    (prisma.user.count as any).mockResolvedValue(1);
    (prisma.user.create as any).mockResolvedValue({ id: "op-novo" });
    const { createOperator } = await import("./team.service");
    await createOperator("dono-1", { name: "Ana", email: "ana@y.com", password: "12345678", canFinance: false });
    const arg = (prisma.user.create as any).mock.calls[0][0];
    expect(arg.data.canFinance).toBe(false);
  });
});

describe("updateOperatorPerms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("faz merge de canFinance só quando informado", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findFirst as any).mockResolvedValue({ id: "op-1" });
    (prisma.user.update as any) = vi.fn().mockResolvedValue({ id: "op-1" });
    const { updateOperatorPerms } = await import("./team.service");

    // Informado → entra no data.
    await updateOperatorPerms("dono-1", "op-1", { canFinance: false });
    expect((prisma.user.update as any).mock.calls[0][0].data).toEqual({ canFinance: false });

    // Omitido → não entra no data (não mexe no campo).
    (prisma.user.update as any).mockClear();
    await updateOperatorPerms("dono-1", "op-1", { canSettings: true });
    const data = (prisma.user.update as any).mock.calls[0][0].data;
    expect(data).toEqual({ canSettings: true });
    expect(data).not.toHaveProperty("canFinance");
  });
});

describe("removeOperator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita quando o operador não pertence ao dono", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findFirst as any).mockResolvedValue(null);
    const { removeOperator } = await import("./team.service");
    await expect(removeOperator("dono-1", "op-de-outro")).rejects.toThrow(/não encontrado/i);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("remove operador do próprio dono, reatribuindo ponteiros de auditoria ao dono", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findFirst as any).mockResolvedValue({ id: "op-1" });
    const tx = (prisma as any).__tx;
    tx.user.delete.mockResolvedValue({ id: "op-1" });
    const { removeOperator } = await import("./team.service");
    await removeOperator("dono-1", "op-1");
    // Comandas/despesas/fixas do operador passam para o dono antes do delete (FKs RESTRICT).
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { openedById: "op-1" }, data: { openedById: "dono-1" } });
    expect(tx.expense.updateMany).toHaveBeenCalledWith({ where: { createdById: "op-1" }, data: { createdById: "dono-1" } });
    expect(tx.recurringExpense.updateMany).toHaveBeenCalledWith({ where: { createdById: "op-1" }, data: { createdById: "dono-1" } });
    // Movimentos de estoque que o operador gerou (baixa ao fechar comanda) também são FK RESTRICT.
    expect(tx.stockMovement.updateMany).toHaveBeenCalledWith({ where: { createdById: "op-1" }, data: { createdById: "dono-1" } });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: "op-1" } });
  });
});
