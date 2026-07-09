import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { getPublicMenu } from "./menu.service";

// O helper de assinatura de Storage mora fora do serviço (chama Supabase).
// Mockamos p/ o teste não depender do Storage: devolve null (item sem foto visível).
vi.mock("@/server/storage/media-storage", () => ({
  createMediaSignedUrl: vi.fn().mockResolvedValue(null),
}));

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `menu_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

/** Marca um item com campos de cardápio (o catalog.service ainda não os expõe no create). */
async function setMenuFields(itemId: string, fields: { menuCategory?: string | null; menuVisible?: boolean; menuDescription?: string | null }) {
  await prisma.catalogItem.update({ where: { id: itemId }, data: fields });
}

describe("menu.service", () => {
  it("agrupa itens visíveis por categoria, exclui ocultos e marca esgotados sem estoque", async () => {
    const acc = await makeOwner();
    const a = await createCatalogItem(acc, { name: "X-Burguer", priceCents: 1500, kind: "PRODUTO" });
    await setMenuFields(a.id, { menuCategory: "Lanches", menuDescription: "Smash 90g" });

    const b = await createCatalogItem(acc, { name: "Escondido", priceCents: 500, kind: "PRODUTO" });
    await setMenuFields(b.id, { menuCategory: "Lanches", menuVisible: false });

    const c = await createCatalogItem(acc, { name: "Refrigerante", priceCents: 600, kind: "PRODUTO" });
    await setMenuFields(c.id, { menuCategory: "Bebidas" });
    // Esgota: controla estoque com qty 0.
    await prisma.catalogItem.update({ where: { id: c.id }, data: { trackStock: true, stockQty: 0 } });

    const menu = await getPublicMenu(acc);
    const cats = menu.categories.map((x) => x.name);
    expect(cats).toContain("Lanches");
    expect(cats).toContain("Bebidas");

    const items = menu.categories.flatMap((x) => x.items);
    const xa = items.find((i) => i.name === "X-Burguer");
    expect(xa).toMatchObject({ priceCents: 1500, available: true, description: "Smash 90g" });
    const xc = items.find((i) => i.name === "Refrigerante");
    expect(xc?.available).toBe(false);
    expect(items.find((i) => i.name === "Escondido")).toBeUndefined();
  });

  it("item inativo (active=false) não aparece", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Pizza", priceCents: 3000, kind: "PRODUTO" });
    await setMenuFields(item.id, { menuCategory: "Pizzas" });
    await prisma.catalogItem.update({ where: { id: item.id }, data: { active: false } });
    const menu = await getPublicMenu(acc);
    expect(menu.categories.flatMap((c) => c.items).find((i) => i.name === "Pizza")).toBeUndefined();
  });

  it("item sem categoria cai em 'Outros' (sempre por último)", async () => {
    const acc = await makeOwner();
    const z = await createCatalogItem(acc, { name: "Zebra", priceCents: 100, kind: "PRODUTO" });
    await setMenuFields(z.id, { menuCategory: "Bebidas" });
    const sem = await createCatalogItem(acc, { name: "Avulso", priceCents: 100, kind: "PRODUTO" });
    await setMenuFields(sem.id, { menuCategory: null });

    const menu = await getPublicMenu(acc);
    const last = menu.categories[menu.categories.length - 1];
    expect(last.name).toBe("Outros");
    expect(last.items.map((i) => i.name)).toContain("Avulso");
  });

  it("item sem menuVisible (default true) aparece", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Brigadeiro", priceCents: 400, kind: "PRODUTO" });
    await setMenuFields(item.id, { menuCategory: "Doces" });
    const menu = await getPublicMenu(acc);
    expect(menu.categories.flatMap((c) => c.items).find((i) => i.id === item.id)).toBeDefined();
  });

  it("escopo por conta: itens de outra conta não vazam", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const item = await createCatalogItem(a, { name: "Segredo", priceCents: 100, kind: "PRODUTO" });
    await setMenuFields(item.id, { menuCategory: "X" });
    const menu = await getPublicMenu(b);
    expect(menu.categories.flatMap((c) => c.items)).toHaveLength(0);
  });

  it("conta sem itens devolve cardápio vazio", async () => {
    const acc = await makeOwner();
    const menu = await getPublicMenu(acc);
    expect(menu.categories).toEqual([]);
  });
});
