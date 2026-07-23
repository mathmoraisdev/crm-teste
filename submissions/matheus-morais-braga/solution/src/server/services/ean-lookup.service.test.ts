import { describe, it, expect, vi, afterEach } from "vitest";
import { prisma } from "@/server/db/client";
import { normalizeGtin, lookupEan } from "./ean-lookup.service";

// GTIN aleatório de 13 dígitos por teste (isola linhas no cache global).
function gtin(): string {
  const n = Math.abs(Math.round(performance.now() * 1000)) % 1_000_000_000;
  return ("789" + String(n).padStart(10, "0")).slice(0, 13);
}

function mockFetchOnce(handler: (url: string) => { status: number; body?: unknown }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const { status, body } = handler(String(input));
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
}

afterEach(() => vi.restoreAllMocks());

describe("ean-lookup.service", () => {
  it("normalizeGtin remove tudo que não é dígito", () => {
    expect(normalizeGtin(" 789-4900 011517 ")).toBe("7894900011517");
  });

  it("miss → chama provider (OFF) → retorna nome e grava cache positivo", async () => {
    const g = gtin();
    const spy = mockFetchOnce(() => ({
      status: 200,
      body: { status: 1, product: { product_name: "Coca Cola LT 350ml", brands: "Coca-Cola" } },
    }));
    const r = await lookupEan(g);
    expect(r.found).toBe(true);
    expect(r.name).toBe("Coca Cola LT 350ml");
    expect(r.source).toBe("openfoodfacts");
    expect(spy).toHaveBeenCalled(); // não fixe a CONTAGEM: se o dev tiver COSMOS_API_TOKEN
                                    // no .env, o Cosmos também bate a rede (→ 2 chamadas).

    // 2ª chamada: servida do cache, sem novo fetch (esta é a asserção que importa).
    spy.mockClear();
    const r2 = await lookupEan(g);
    expect(r2.name).toBe("Coca Cola LT 350ml");
    expect(spy).not.toHaveBeenCalled();
  });

  it("provider diz 'não encontrado' (status 0) → grava cache negativo e não rebate dentro do TTL", async () => {
    const g = gtin();
    const spy = mockFetchOnce(() => ({ status: 200, body: { status: 0 } }));
    const r = await lookupEan(g);
    expect(r.found).toBe(false);
    expect(spy).toHaveBeenCalled();

    spy.mockClear();
    const r2 = await lookupEan(g);
    expect(r2.found).toBe(false);
    expect(spy).not.toHaveBeenCalled(); // cache negativo fresco
  });

  it("erro de rede em TODOS os providers → fail-open (found:false) e NÃO envenena o cache", async () => {
    const g = gtin();
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const r = await lookupEan(g);
    expect(r.found).toBe(false);
    const row = await prisma.eanCache.findUnique({ where: { gtin: g } });
    expect(row).toBeNull(); // outage não vira cache negativo
    spy.mockRestore();
  });

  it("gtin curto (<8) retorna found:false sem tocar rede", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await lookupEan("123");
    expect(r.found).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("DotCompany: OFF não tem (miss) → DotCompany acha por produto.descricao", async () => {
    const g = gtin();
    mockFetchOnce((url) => {
      if (url.includes("openfoodfacts")) return { status: 200, body: { status: 0 } }; // OFF miss
      if (url.includes("dotcompany")) return {
        status: 200,
        // ncm vem como OBJETO na API real ({codigo, codigo_formatado, descricao}),
        // não escalar — o provider extrai só o código cru.
        body: { sucesso: true, produto: { descricao: "CIGARRO MARLBORO BOX 20UN", marca: "Marlboro", ncm: { codigo: "24022000", codigo_formatado: "2402.20.00", descricao: null } } },
      };
      return { status: 200, body: {} };
    });
    const r = await lookupEan(g);
    expect(r.found).toBe(true);
    expect(r.name).toBe("CIGARRO MARLBORO BOX 20UN");
    expect(r.source).toBe("dotcompany");
    expect(r.ncm).toBe("24022000"); // código cru, nunca "[object Object]"
  });

  it("DotCompany: sucesso:false é 'não achei' (miss), não erro", async () => {
    const g = gtin();
    mockFetchOnce((url) => {
      if (url.includes("dotcompany")) return { status: 200, body: { sucesso: false } };
      return { status: 200, body: { status: 0 } }; // OFF também miss
    });
    const r = await lookupEan(g);
    expect(r.found).toBe(false);
    // gravou cache negativo (alguém confirmou "não existe")
    const row = await prisma.eanCache.findUnique({ where: { gtin: g } });
    expect(row?.found).toBe(false);
  });

  it("DotCompany: resposta com campo 'erro' (limite/400) vira error, NÃO polui cache", async () => {
    const g = gtin();
    mockFetchOnce((url) => {
      // OFF erro de rede + DotCompany devolve erro de limite → ninguém confirmou miss
      if (url.includes("dotcompany")) return { status: 200, body: { sucesso: false, erro: "Limite diário excedido" } };
      return { status: 500, body: {} }; // OFF error
    });
    const r = await lookupEan(g);
    expect(r.found).toBe(false);
    const row = await prisma.eanCache.findUnique({ where: { gtin: g } });
    expect(row).toBeNull(); // nada foi confirmado como "não existe" → não cacheia negativo
  });

  it("não-alimento: OFF diz miss mas DotCompany está SEM COTA (error) → NÃO grava negativo (não trava 30d)", async () => {
    const g = gtin();
    mockFetchOnce((url) => {
      // OFF só tem alimento → "miss" p/ não-alimento (não é autoritativo)
      if (url.includes("openfoodfacts")) return { status: 200, body: { status: 0 } };
      // DotCompany (que TERIA o item) sem cota → error de runtime
      if (url.includes("dotcompany")) return { status: 200, body: { sucesso: false, erro: "Limite diário excedido" } };
      return { status: 500, body: {} }; // Cosmos (se tiver token) → error; sem token → skip
    });
    const r = await lookupEan(g);
    expect(r.found).toBe(false);
    // houve erro de runtime num provider capaz → o "miss" do OFF não confirma ausência
    const row = await prisma.eanCache.findUnique({ where: { gtin: g } });
    expect(row).toBeNull(); // retentável na próxima; NÃO envenenou por 30 dias
  });
});
