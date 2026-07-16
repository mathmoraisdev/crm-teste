import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import {
  listCommissionRules,
  createCommissionRule,
  updateCommissionRule,
  deactivateCommissionRule,
} from "./commission.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `comm_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "Dono", passwordHash: "x" },
  });
  return u.id;
}
async function makePro(accountId: string, name = "João") {
  const p = await prisma.professional.create({ data: { accountId, name } });
  return p.id;
}
async function makeItem(accountId: string, name = "Corte") {
  const c = await prisma.catalogItem.create({ data: { accountId, name, priceCents: 5000 } });
  return c.id;
}

describe("commission.service", () => {
  it("cria regra percentual válida", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    const r = await createCommissionRule(accountId, { professionalId, percentBps: 4000 });
    expect(r.percentBps).toBe(4000);
    expect(r.fixedCents).toBeNull();
  });
  it("cria regra fixa válida", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    const r = await createCommissionRule(accountId, { professionalId, fixedCents: 1000 });
    expect(r.fixedCents).toBe(1000);
    expect(r.percentBps).toBeNull();
  });
  it("rejeita percent E fixo juntos", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    await expect(createCommissionRule(accountId, { professionalId, percentBps: 4000, fixedCents: 1000 }))
      .rejects.toThrow();
  });
  it("rejeita nenhum dos dois", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    await expect(createCommissionRule(accountId, { professionalId })).rejects.toThrow();
  });
  it("rejeita percentBps fora de 1..10000", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    await expect(createCommissionRule(accountId, { professionalId, percentBps: 0 })).rejects.toThrow();
    await expect(createCommissionRule(accountId, { professionalId, percentBps: 10001 })).rejects.toThrow();
  });
  it("rejeita fixedCents <= 0", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    await expect(createCommissionRule(accountId, { professionalId, fixedCents: 0 })).rejects.toThrow();
  });
  it("barra segunda regra-padrão do mesmo profissional (unicidade no serviço)", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    await createCommissionRule(accountId, { professionalId, percentBps: 3000 });
    await expect(createCommissionRule(accountId, { professionalId, percentBps: 4000 })).rejects.toThrow();
  });
  it("permite regra-padrão + regra específica de serviço", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    const catalogItemId = await makeItem(accountId);
    await createCommissionRule(accountId, { professionalId, percentBps: 3000 });
    const svc = await createCommissionRule(accountId, { professionalId, catalogItemId, percentBps: 5000 });
    expect(svc.catalogItemId).toBe(catalogItemId);
  });
  it("profissional de outra conta → erro", async () => {
    const accountId = await makeOwner();
    const other = await makeOwner();
    const otherAccountProId = await makePro(other);
    await expect(createCommissionRule(accountId, { professionalId: otherAccountProId, percentBps: 4000 }))
      .rejects.toThrow();
  });
  it("serviço de outra conta → erro", async () => {
    const accountId = await makeOwner();
    const other = await makeOwner();
    const professionalId = await makePro(accountId);
    const foreignItem = await makeItem(other);
    await expect(createCommissionRule(accountId, { professionalId, catalogItemId: foreignItem, percentBps: 4000 }))
      .rejects.toThrow();
  });
  it("lista com nomes de profissional/serviço, não vaza entre contas", async () => {
    const accountId = await makeOwner();
    const other = await makeOwner();
    const professionalId = await makePro(accountId, "Ana");
    const catalogItemId = await makeItem(accountId, "Barba");
    await createCommissionRule(accountId, { professionalId, catalogItemId, percentBps: 5000 });
    await createCommissionRule(other, { professionalId: await makePro(other), percentBps: 2000 });
    const list = await listCommissionRules(accountId);
    expect(list).toHaveLength(1);
    expect(list[0].professionalName).toBe("Ana");
    expect(list[0].serviceName).toBe("Barba");
  });
  it("update troca percent↔fixo e reaplica validação", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    const r = await createCommissionRule(accountId, { professionalId, percentBps: 4000 });
    const upd = await updateCommissionRule(accountId, r.id, { fixedCents: 1500, percentBps: null });
    expect(upd.fixedCents).toBe(1500);
    expect(upd.percentBps).toBeNull();
    // conta errada não altera
    const other = await makeOwner();
    await expect(updateCommissionRule(other, r.id, { percentBps: 1000 })).rejects.toThrow();
  });
  it("deactivate é soft (active=false)", async () => {
    const accountId = await makeOwner();
    const professionalId = await makePro(accountId);
    const r = await createCommissionRule(accountId, { professionalId, percentBps: 4000 });
    const off = await deactivateCommissionRule(accountId, r.id);
    expect(off.active).toBe(false);
    const still = await prisma.commissionRule.findUnique({ where: { id: r.id } });
    expect(still).not.toBeNull();
  });
});
