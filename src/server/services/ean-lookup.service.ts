import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";

export interface EanInfo {
  found: boolean;
  name: string | null;
  brand: string | null;
  ncm: string | null;
  source: string | null;
}

const NOT_FOUND: EanInfo = { found: false, name: null, brand: null, ncm: null, source: null };

/** Só dígitos (o leitor às vezes injeta espaço/traço). */
export function normalizeGtin(raw: string): string {
  return (raw ?? "").replace(/\D/g, "");
}

// Resultado tri-estado do fetch: distinguir "não achou" (definitivo) de "erro"
// (rede/timeout) evita gravar cache negativo por causa de uma queda temporária.
type FetchResult = { kind: "ok"; data: any } | { kind: "notfound" } | { kind: "error" };

async function fetchJson(url: string, headers: Record<string, string>): Promise<FetchResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), env.EAN_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.status === 404) return { kind: "notfound" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", data: await res.json() };
  } catch {
    return { kind: "error" }; // timeout/rede = "não sei", não "não existe"
  } finally {
    clearTimeout(t);
  }
}

// Cada provider: EanInfo (achou) | "miss" (respondeu, não existe) | "error" (sem sinal).
type ProviderResult = EanInfo | "miss" | "error";

/** Cosmos (Bluesoft): melhor cobertura BR, inclui não-alimento. Requer token. */
async function fromCosmos(gtin: string): Promise<ProviderResult> {
  if (!env.COSMOS_API_TOKEN) return "error"; // sem token → provider pulado (não é "miss")
  const r = await fetchJson(`${env.COSMOS_BASE_URL}/gtins/${gtin}.json`, {
    "X-Cosmos-Token": env.COSMOS_API_TOKEN,
    "User-Agent": "Cosmos-API-Request",
    "Content-Type": "application/json",
  });
  if (r.kind === "notfound") return "miss";
  if (r.kind === "error") return "error";
  const name = typeof r.data?.description === "string" ? r.data.description.trim() : "";
  if (!name) return "miss";
  return {
    found: true,
    name,
    brand: r.data?.brand?.name ? String(r.data.brand.name).trim() : null,
    ncm: r.data?.ncm?.code ? String(r.data.ncm.code) : null,
    source: "cosmos",
  };
}

/** Open Food Facts: grátis, sem chave, só alimento/bebida. Fallback + base dev. */
async function fromOpenFoodFacts(gtin: string): Promise<ProviderResult> {
  const r = await fetchJson(
    `https://world.openfoodfacts.org/api/v2/product/${gtin}.json?fields=product_name,brands`,
    { "User-Agent": "crm-ean-lookup/1.0" },
  );
  if (r.kind === "notfound") return "miss";
  if (r.kind === "error") return "error";
  if (r.data?.status !== 1) return "miss";
  const name = typeof r.data?.product?.product_name === "string" ? r.data.product.product_name.trim() : "";
  if (!name) return "miss"; // achou o registro mas sem nome → inútil p/ sugerir
  return {
    found: true,
    name,
    brand: r.data?.product?.brands ? String(r.data.product.brands).split(",")[0].trim() : null,
    ncm: null,
    source: "openfoodfacts",
  };
}

/** DotCompany (erp.dotcompany.com.br): grátis, sem chave, ~25/dia por IP.
 *  Cobre alimento E não-alimento; honesta no miss (sucesso:false). */
async function fromDotCompany(gtin: string): Promise<ProviderResult> {
  if (env.DOTCOMPANY_DISABLED) return "error";
  const r = await fetchJson(`${env.DOTCOMPANY_BASE_URL}/api/catalogo/public/buscar?q=${gtin}`, {
    "User-Agent": "crm-ean-lookup/1.0",
    Accept: "application/json",
  });
  if (r.kind === "notfound") return "miss";
  if (r.kind === "error") return "error";
  // Campo `erro` = limite/requisição inválida → NÃO é "não existe" (protege o cache).
  if (r.data?.erro) return "error";
  if (!r.data?.sucesso || !r.data?.produto) return "miss";
  const name = typeof r.data.produto?.descricao === "string" ? r.data.produto.descricao.trim() : "";
  if (!name) return "miss";
  // A DotCompany devolve ncm como objeto {codigo, codigo_formatado, descricao};
  // guardamos só o código cru de 8 dígitos (mesmo formato que a Cosmos e o que o
  // fiscal espera). Defensivo: aceita escalar também, nunca vira "[object Object]".
  const ncmRaw = r.data.produto?.ncm;
  const ncm =
    ncmRaw && typeof ncmRaw === "object"
      ? (ncmRaw.codigo ? String(ncmRaw.codigo) : null)
      : ncmRaw ? String(ncmRaw) : null;
  return {
    found: true,
    name,
    brand: r.data.produto?.marca ? String(r.data.produto.marca).trim() : null,
    ncm,
    source: "dotcompany",
  };
}

// Ordem = do mais barato/abundante ao mais escasso. OFF (alimento, ilimitado) →
// DotCompany (não-alimento grátis, ~25/dia por IP) → Cosmos (cota escassa da
// plataforma, melhor cobertura) por ÚLTIMO. Cobertura é a união; a ordem só
// decide qual fonte responde e qual cota é gasta.
const PROVIDERS = [fromOpenFoodFacts, fromDotCompany, fromCosmos];

/** Consulta um código de barras → nome/marca. Cache global first, fail-open. */
export async function lookupEan(rawBarcode: string): Promise<EanInfo> {
  if (env.EAN_LOOKUP_DISABLED) return NOT_FOUND;
  const gtin = normalizeGtin(rawBarcode);
  if (gtin.length < 8) return NOT_FOUND; // EAN-8 é o menor válido

  // 1) Cache global
  const cached = await prisma.eanCache.findUnique({ where: { gtin } }).catch(() => null);
  if (cached) {
    if (cached.found) {
      return { found: true, name: cached.name, brand: cached.brand, ncm: cached.ncm, source: cached.source };
    }
    const ageDays = (Date.now() - cached.fetchedAt.getTime()) / 86_400_000;
    if (ageDays < env.EAN_NEGATIVE_TTL_DAYS) return NOT_FOUND; // negativo ainda fresco
  }

  // 2) Providers em ordem; primeiro que ACHAR vence. Registra se algum deu "miss".
  let hit: EanInfo | null = null;
  let sawMiss = false;
  for (const p of PROVIDERS) {
    const res = await p(gtin);
    if (res === "miss") { sawMiss = true; continue; }
    if (res === "error") continue;
    hit = res;
    break;
  }

  // 3) Cache: grava positivo sempre; negativo só se ALGUÉM confirmou "não existe"
  //    (evita envenenar o cache quando foi só outage/timeout em todos).
  if (hit || sawMiss) {
    const payload = {
      found: !!hit,
      name: hit?.name ?? null,
      brand: hit?.brand ?? null,
      ncm: hit?.ncm ?? null,
      source: hit?.source ?? null,
    };
    await prisma.eanCache
      .upsert({ where: { gtin }, create: { gtin, ...payload }, update: { ...payload, fetchedAt: new Date() } })
      .catch(() => { /* cache é otimização; nunca quebra o fluxo */ });
  }

  return hit ?? NOT_FOUND;
}
