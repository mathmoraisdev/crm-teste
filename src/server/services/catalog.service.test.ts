import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem, listCatalogItems, updateCatalogItem, deleteCatalogItem, seedCatalogFromTemplate, findByBarcode } from "./catalog.service";

// Cria um usuário-dono descartável por teste (isolamento).
async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `cat_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("catalog.service", () => {
  it("cria item e lista escopado por conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await createCatalogItem(a, { name: "Corte", priceCents: 4000, kind: "SERVICO" });
    await createCatalogItem(b, { name: "X-Burguer", priceCents: 2500, kind: "PRODUTO" });
    const listA = await listCatalogItems(a);
    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe("Corte");
    expect(listA[0].priceCents).toBe(4000);
  });

  it("rejeita nome vazio e preço negativo", async () => {
    const a = await makeOwner();
    await expect(createCatalogItem(a, { name: "  ", priceCents: 1000 })).rejects.toThrow();
    await expect(createCatalogItem(a, { name: "X", priceCents: -1 })).rejects.toThrow();
  });

  it("update só afeta item da própria conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const item = await createCatalogItem(a, { name: "Barba", priceCents: 3000 });
    await expect(updateCatalogItem(b, item.id, { priceCents: 1 })).rejects.toThrow();
    const upd = await updateCatalogItem(a, item.id, { priceCents: 3500, active: false });
    expect(upd.priceCents).toBe(3500);
    expect(upd.active).toBe(false);
  });

  it("delete remove o item", async () => {
    const a = await makeOwner();
    const item = await createCatalogItem(a, { name: "Sobrancelha", priceCents: 1500 });
    await deleteCatalogItem(a, item.id);
    expect(await listCatalogItems(a)).toHaveLength(0);
  });

  it("seedCatalogFromTemplate semeia itens do ramo com preço zerado", async () => {
    const a = await makeOwner();
    const items = await seedCatalogFromTemplate(a, "barbearia");
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((i) => i.name)).toContain("Corte");
    expect(items.every((i) => i.priceCents === 0)).toBe(true); // dono precifica depois
  });

  it("seed é não-destrutivo: recusa se o catálogo já tem itens", async () => {
    const a = await makeOwner();
    await createCatalogItem(a, { name: "Já existe", priceCents: 100 });
    await expect(seedCatalogFromTemplate(a, "barbearia")).rejects.toThrow();
  });

  it("seed rejeita modelo inexistente ou sem itens", async () => {
    const a = await makeOwner();
    await expect(seedCatalogFromTemplate(a, "nao-existe")).rejects.toThrow();
    await expect(seedCatalogFromTemplate(a, "advocacia")).rejects.toThrow(); // só placeholder
  });

  it("usa priceCents do catalogPreset quando informado", async () => {
    const acc = await makeOwner();
    // A ótica tem preset com itens precificados (Lentes de grau/contato).
    const items = await seedCatalogFromTemplate(acc, "otica");
    expect(items.some((i) => i.priceCents > 0)).toBe(true);
  });

  it("ramo só-heurística continua nascendo com preço 0", async () => {
    const acc = await makeOwner();
    // Salão de beleza não tem catalogPreset — só heurística.
    const items = await seedCatalogFromTemplate(acc, "salao-beleza");
    expect(items.every((i) => i.priceCents === 0)).toBe(true);
  });

  it("cria produto com controle de estoque e expõe os campos", async () => {
    const a = await makeOwner();
    const item = await createCatalogItem(a, {
      name: "Pomada", priceCents: 2500, kind: "PRODUTO",
      trackStock: true, sku: "POM-01", minStock: 3, costCents: 1200,
    });
    expect(item.trackStock).toBe(true);
    expect(item.sku).toBe("POM-01");
    expect(item.stockQty).toBe(0); // nasce zerado; entra estoque via movimento
    expect(item.minStock).toBe(3);
    expect(item.costCents).toBe(1200);

    const upd = await updateCatalogItem(a, item.id, { minStock: 5, trackStock: false, sku: null });
    expect(upd.minStock).toBe(5);
    expect(upd.trackStock).toBe(false);
    expect(upd.sku).toBeNull();
  });

  it("durationMinutes faz round-trip para serviço e aceita null", async () => {
    const a = await makeOwner();
    const item = await createCatalogItem(a, { name: "Corte", priceCents: 4000, kind: "SERVICO", durationMinutes: 45 });
    expect(item.durationMinutes).toBe(45);
    const semDur = await createCatalogItem(a, { name: "Barba", priceCents: 3000, kind: "SERVICO" });
    expect(semDur.durationMinutes).toBeNull();
    const upd = await updateCatalogItem(a, item.id, { durationMinutes: 30 });
    expect(upd.durationMinutes).toBe(30);
    const cleared = await updateCatalogItem(a, item.id, { durationMinutes: null });
    expect(cleared.durationMinutes).toBeNull();
  });

  it("serviço comum ignora campos de estoque (default off)", async () => {
    const a = await makeOwner();
    const item = await createCatalogItem(a, { name: "Corte", priceCents: 4000, kind: "SERVICO" });
    expect(item.trackStock).toBe(false);
    expect(item.stockQty).toBe(0);
    expect(item.sku).toBeNull();
  });

  it("barcode é único por conta (P2002 vira erro amigável)", async () => {
    const acc = await makeOwner();
    await createCatalogItem(acc, { name: "A", priceCents: 100, kind: "PRODUTO", barcode: "789" });
    await expect(createCatalogItem(acc, { name: "B", priceCents: 200, kind: "PRODUTO", barcode: "789" }))
      .rejects.toThrow(/código de barras|já/i);
  });

  it("contas diferentes podem repetir o mesmo barcode", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await createCatalogItem(a, { name: "A", priceCents: 100, kind: "PRODUTO", barcode: "789" });
    await expect(createCatalogItem(b, { name: "A", priceCents: 100, kind: "PRODUTO", barcode: "789" })).resolves.toBeTruthy();
  });

  it("findByBarcode resolve o item da conta pelo código", async () => {
    const acc = await makeOwner();
    const p = await createCatalogItem(acc, { name: "A", priceCents: 100, kind: "PRODUTO", barcode: "789" });
    expect((await findByBarcode(acc, "789"))?.id).toBe(p.id);
    expect(await findByBarcode(acc, "000")).toBeNull(); // inexistente
    expect(await findByBarcode(acc, "  ")).toBeNull(); // vazio
  });

  it("persiste variantGroup (grade) e devolve no DTO; update limpa com null", async () => {
    const acc = await makeOwner();
    const p = await createCatalogItem(acc, { name: "Camiseta P", priceCents: 3000, kind: "PRODUTO", variantGroup: "Camiseta" });
    expect(p.variantGroup).toBe("Camiseta");
    const cleared = await updateCatalogItem(acc, p.id, { variantGroup: null });
    expect(cleared.variantGroup).toBeNull();
  });
});
