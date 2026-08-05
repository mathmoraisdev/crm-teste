import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { getPublicMenu } from "./menu.service";
import { saveItemModifiers } from "./modifier.service";

// O helper de URL pública de Storage mora fora do serviço (chama Supabase).
// Mockamos p/ o teste não depender do Storage: devolve null (item sem foto visível).
vi.mock("@/server/storage/catalog-storage", () => ({
  getCatalogPublicUrl: vi.fn(() => null),
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

  it("respeita a ordem manual (categoryOrder); categoria fora da lista vem depois; 'Outros' por último", async () => {
    const acc = await makeOwner();
    const mk = async (name: string, cat: string | null) => {
      const it = await createCatalogItem(acc, { name, priceCents: 100, kind: "PRODUTO" });
      await setMenuFields(it.id, { menuCategory: cat });
    };
    await mk("Coca", "Bebidas");
    await mk("X-Burguer", "Lanches");
    await mk("Pudim", "Sobremesas");
    await mk("Brinde", "Zap"); // não está na ordem manual
    await mk("Avulso", null); // vai p/ "Outros"

    // Ordem manual: comida primeiro, bebida por último (o pedido original do dono).
    await prisma.deliverySettings.create({
      data: { accountId: acc, categoryOrderJson: ["Lanches", "Sobremesas", "Bebidas"] },
    });

    const menu = await getPublicMenu(acc);
    expect(menu.categories.map((c) => c.name)).toEqual([
      "Lanches",
      "Sobremesas",
      "Bebidas",
      "Zap", // fora da ordem → depois das ordenadas (alfabético entre si)
      "Outros", // sem categoria → sempre por último
    ]);
  });

  it("sem categoryOrder, mantém ordem alfabética (com 'Outros' por último)", async () => {
    const acc = await makeOwner();
    const mk = async (name: string, cat: string) => {
      const it = await createCatalogItem(acc, { name, priceCents: 100, kind: "PRODUTO" });
      await setMenuFields(it.id, { menuCategory: cat });
    };
    await mk("Coca", "Bebidas");
    await mk("X-Burguer", "Lanches");

    const menu = await getPublicMenu(acc);
    expect(menu.categories.map((c) => c.name)).toEqual(["Bebidas", "Lanches"]);
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

  it("expõe os grupos de adicionais por item (só opções ativas)", async () => {
    const acc = await makeOwner();
    const burger = await createCatalogItem(acc, { name: "Burger", priceCents: 2000, kind: "PRODUTO" });
    await setMenuFields(burger.id, { menuCategory: "Lanches" });
    await saveItemModifiers(acc, burger.id, [
      { name: "Tamanho", minSelect: 1, maxSelect: 1, options: [
        { name: "Média", priceDeltaCents: 0 }, { name: "Grande", priceDeltaCents: 800 } ] },
      { name: "Extras", minSelect: 0, maxSelect: 2, options: [
        { name: "Bacon", priceDeltaCents: 500 }, { name: "Fora de linha", priceDeltaCents: 100, active: false } ] },
    ]);

    const menu = await getPublicMenu(acc);
    const item = menu.categories.flatMap((c) => c.items).find((i) => i.id === burger.id)!;
    expect(item.modifierGroups).toHaveLength(2);
    const tamanho = item.modifierGroups.find((g) => g.name === "Tamanho")!;
    expect(tamanho).toMatchObject({ minSelect: 1, maxSelect: 1 });
    expect(tamanho.options.map((o) => o.name)).toEqual(["Média", "Grande"]);
    const extras = item.modifierGroups.find((g) => g.name === "Extras")!;
    // opção inativa NÃO vaza no cardápio público
    expect(extras.options.map((o) => o.name)).toEqual(["Bacon"]);
    expect(extras.options[0]).toMatchObject({ priceDeltaCents: 500 });
    expect(typeof extras.options[0].id).toBe("string");
  });

  it("item sem grupos → modifierGroups vazio", async () => {
    const acc = await makeOwner();
    const item = await createCatalogItem(acc, { name: "Suco", priceCents: 800, kind: "PRODUTO" });
    await setMenuFields(item.id, { menuCategory: "Bebidas" });
    const menu = await getPublicMenu(acc);
    const dto = menu.categories.flatMap((c) => c.items).find((i) => i.id === item.id)!;
    expect(dto.modifierGroups).toEqual([]);
  });
});
