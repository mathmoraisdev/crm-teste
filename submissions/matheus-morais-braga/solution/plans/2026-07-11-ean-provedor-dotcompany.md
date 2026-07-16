# Provedor adicional de EAN: DotCompany (esticar cota grátis) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar a **DotCompany** como 3º provedor grátis na cadeia de lookup de EAN, para cobrir não-alimento sem gastar a cota escassa da Cosmos — e reordenar a cadeia para **conservar a cota da Cosmos** (fontes grátis/ilimitadas primeiro, Cosmos por último).

**Architecture:** Estende o `ean-lookup.service.ts` já implementado e verificado. Adiciona `fromDotCompany` seguindo o mesmo contrato tri-estado (`EanInfo | "miss" | "error"`) dos providers existentes, e reordena o array `PROVIDERS`. Nenhuma mudança de rota, UI ou schema — só o serviço + env + testes.

**Tech Stack:** igual ao serviço existente (Prisma/PostgreSQL, Zod, Vitest, `fetch` nativo).

---

## Contexto: por que só a DotCompany (achados de teste AO VIVO)

Sondei os 4 candidatos com `fetch` real antes de planejar. Resultado:

| Fonte | Situação | Entra? |
|---|---|---|
| **DotCompany** | API REST JSON funcional, sem chave, honesta no "não achei" (testada com 4 EANs aleatórios → `sucesso:false`) | ✅ **Sim** |
| **produto.xyz** | Endpoint `/v1/gtin` retorna **404** (morta; era alpha 0.0.1) | ❌ Não |
| **Seu Negócio na Nuvem** | **Certificado TLS expirado** (o `fetch` rejeita) | ❌ Não |
| **GS1 Brasil** | Exige **ser associado** + credenciais OAuth aprovadas por e-mail (`api@gs1br.org`) | ❌ Não (só se o dono virar associado) |

### API real da DotCompany (confirmada por sonda ao vivo)
- **Host:** `https://erp.dotcompany.com.br` (⚠️ NÃO é `dotcompany.com.br` — esse serve o site e devolve HTML)
- **Consulta:** `GET /api/catalogo/public/buscar?q={gtin}` (o parâmetro é **`q`**; qualquer outro nome dá HTTP 400)
- **Cota:** `GET /api/catalogo/public/limite` → `{ "limite_diario": 25, "consultas_restantes": N, "reset": "meia-noite" }`
- **Sem autenticação** (tier grátis)
- **Achou** (HTTP 200): `{ "sucesso": true, "produto": { "descricao": "COCA-COLA SABOR ORIGINAL PET 2L", "marca": ..., "ncm": ..., "cest": {...}, ... }, "ibptax": {...} }` — **nome = `produto.descricao`**
- **Não achou** (HTTP 200): `{ "sucesso": false }` (sem `produto`, sem `erro`)
- **Erro/limite** (HTTP 400 ou 200 com `erro`): tem campo `"erro"` → tratar como `error`, NUNCA como "não existe"

### ⚠️ Caveats reais (documentar, não esconder)
1. **Conta TODA requisição contra os 25/dia — inclusive erros.** (Vi o contador cair 25→24→…→19 durante os testes, mesmo em requests malformados.)
2. **Limite é por IP.** Na Vercel (serverless) o IP de saída é compartilhado/rotativo → esse "+25/dia" é **bônus best-effort**, não garantido. Pode render menos (IP compartilhado) ou mais (IPs rotativos). Fail-open cobre: acabou a cota → cai pro próximo provider.

---

## Ordem da cadeia: conservar a cota da Cosmos

**Hoje** (já implementado): `[fromCosmos, fromOpenFoodFacts]` — Cosmos **primeiro**, o que gasta a cota escassa/compartilhada da Cosmos até em produto que o OFF resolveria de graça.

**Novo:** `[fromOpenFoodFacts, fromDotCompany, fromCosmos]`
- **OFF** (grátis, ilimitado p/ o nosso volume) primeiro → drena alimento/bebida sem custo.
- **DotCompany** (grátis, ~25/dia por IP) → pega o não-alimento de graça.
- **Cosmos** (cota escassa, compartilhada pela plataforma — mas melhor cobertura) **por último** → só o que as grátis não acharam.

A cobertura é a **união** (todo provider é tentado até um acerto), então mover a Cosmos p/ o fim **não perde cobertura** — só troca *qual fonte responde* e *qual cota é gasta*. Isso atende diretamente ao objetivo (esticar o grátis).

> Trade-off: o OFF às vezes dá nome comunitário menos padronizado que a Cosmos. Como o nome é **editável** e a meta é economizar cota, priorizamos grátis. Se um dia preferir qualidade sobre cota, basta reordenar o array (uma linha).

---

## Task 1: Variáveis de ambiente da DotCompany

**Files:**
- Modify: `src/lib/env.ts` (no bloco EAN, ~linha 158-168)
- Modify: `.env.example`

**Step 1: Adicionar ao schema zod** (logo após as envs da Cosmos)

```ts
  // DotCompany: provedor grátis adicional (sem chave, ~25/dia POR IP — conta até
  // erros; na Vercel o IP é compartilhado, então é bônus best-effort). Honesta no
  // "não achei" (sucesso:false). DOTCOMPANY_DISABLED=true desliga (idioma da casa).
  DOTCOMPANY_DISABLED: z.coerce.boolean().default(false),
  DOTCOMPANY_BASE_URL: z.string().default("https://erp.dotcompany.com.br"),
```

**Step 2: Documentar no `.env.example`**

```dotenv
# DotCompany: provedor grátis adicional de nome por código de barras (sem chave,
# ~25/dia por IP). P/ DESLIGAR: DOTCOMPANY_DISABLED=true (não coloque =false).
# DOTCOMPANY_DISABLED=true
DOTCOMPANY_BASE_URL=https://erp.dotcompany.com.br
```

**Step 3: Verificar tipos**

Run: `npm run lint`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(ean): env do provedor DotCompany"
```

---

## Task 2: Provider `fromDotCompany` + reordenar a cadeia

**Files:**
- Modify: `src/server/services/ean-lookup.service.ts`
- Modify: `src/server/services/ean-lookup.service.test.ts`

**Step 1: Escrever os testes primeiro** (adicionar ao `describe` existente)

```ts
  it("DotCompany: OFF não tem (miss) → DotCompany acha por produto.descricao", async () => {
    const g = gtin();
    mockFetchOnce((url) => {
      if (url.includes("openfoodfacts")) return { status: 200, body: { status: 0 } }; // OFF miss
      if (url.includes("dotcompany")) return {
        status: 200,
        body: { sucesso: true, produto: { descricao: "CIGARRO MARLBORO BOX 20UN", marca: "Marlboro", ncm: "24022000" } },
      };
      return { status: 200, body: {} };
    });
    const r = await lookupEan(g);
    expect(r.found).toBe(true);
    expect(r.name).toBe("CIGARRO MARLBORO BOX 20UN");
    expect(r.source).toBe("dotcompany");
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
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/ean-lookup.service.test.ts`
Expected: os 3 novos FALHAM (`fromDotCompany` ainda não existe / não está na cadeia).

**Step 3: Implementar `fromDotCompany` e reordenar**

Em `src/server/services/ean-lookup.service.ts`, adicionar o provider (perto de `fromOpenFoodFacts`):

```ts
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
  return {
    found: true,
    name,
    brand: r.data.produto?.marca ? String(r.data.produto.marca).trim() : null,
    ncm: r.data.produto?.ncm ? String(r.data.produto.ncm) : null,
    source: "dotcompany",
  };
}
```

Trocar o array `PROVIDERS` (conservar a cota da Cosmos — grátis primeiro, Cosmos por último):

```ts
// Ordem = do mais barato/abundante ao mais escasso. OFF (alimento, ilimitado) →
// DotCompany (não-alimento grátis, ~25/dia por IP) → Cosmos (cota escassa da
// plataforma, melhor cobertura) por ÚLTIMO. Cobertura é a união; a ordem só
// decide qual fonte responde e qual cota é gasta.
const PROVIDERS = [fromOpenFoodFacts, fromDotCompany, fromCosmos];
```

**Step 4: Rodar e ver passar (todos)**

Run: `npx vitest run src/server/services/ean-lookup.service.test.ts`
Expected: PASS (os 5 antigos + 3 novos = 8).

**Step 5: Commit**

```bash
git add src/server/services/ean-lookup.service.ts src/server/services/ean-lookup.service.test.ts
git commit -m "feat(ean): provedor DotCompany + cadeia conserva cota da Cosmos"
```

---

## Task 3: Verificação end-to-end (real, não só mock)

**Files:** nenhuma (só verificação)

**Step 1: Probe real da cadeia** — criar `scripts/_verify-ean2.ts` (descartável):

```ts
import { lookupEan } from "@/server/services/ean-lookup.service";
(async () => {
  for (const c of ["7894900011517" /* refri: OFF */, "7891000053508" /* Nescau */]) {
    const r = await lookupEan(c);
    console.log(`${c} -> ${JSON.stringify(r)}`);
  }
  process.exit(0);
})();
```

Run: `npx tsx --env-file-if-exists=.env scripts/_verify-ean2.ts`
Expected: retorna `found:true` com `source` = `openfoodfacts` (ou `dotcompany` p/ não-alimento). Nenhuma exceção.

> A DotCompany conta cada chamada contra os 25/dia do IP — não rode em loop. Uma ou duas verificações bastam.

**Step 2: Apagar o script de verificação**

```bash
rm scripts/_verify-ean2.ts
```

**Step 3: Suíte inteira (garantir que nada quebrou)**

Run: `npm test`
Expected: tudo verde (a suíte existente + os 3 testes novos).

**Step 4: Commit** (se houver algo pendente; senão pular)

---

## Deploy (PROD)

1. **Sem migration, sem schema, sem UI** — só código de serviço + env. Deploy de código puro.
2. **Env na Vercel (web):** `DOTCOMPANY_BASE_URL` já tem default no código; não precisa setar nada p/ ligar (sobe LIGADO). P/ desligar: `DOTCOMPANY_DISABLED=true`. **Worker Oracle não precisa** (cadastro roda só no web).
3. **Deploy web:** `env -u CLAUDECODE CI=1 npx vercel deploy --prod` (memória `vercel-hobby-push-block`).
4. **Smoke:** cadastrar um produto **não-alimentício** (ex.: cigarro, produto de limpeza) bipando o código → nome deve sugerir (fonte DotCompany), sem precisar do token Cosmos.

## Riscos & mitigação

- **Cota por IP imprevisível na Vercel** → é bônus best-effort; fail-open cai pro Cosmos/manual quando acaba. O `erro`→`error` evita cachear negativo por limite.
- **Latência de um MISS total** → a cadeia agora tem 3 providers em série; um código que ninguém tem pode levar alguns segundos na 1ª vez (depois vira cache negativo). A UI não bloqueia (o lojista digita enquanto busca) e o timeout curto (`EAN_LOOKUP_TIMEOUT_MS`) limita cada etapa.
- **Cache negativo em janela de outage da DotCompany** → se um não-alimento existe só na DotCompany e ela está fora/sem-cota no momento, o OFF confirma miss e grava negativo por `EAN_NEGATIVE_TTL_DAYS` (30). Bounded; com token Cosmos ligado, a Cosmos pega antes. Aceitável no MVP.
- **DotCompany muda o endpoint** (não é contrato público versionado) → `DOTCOMPANY_BASE_URL` é env; se mudar o host, troca sem deploy de código. Se mudarem o path/shape, o provider vira `miss`/`error` (fail-open) e o `DOTCOMPANY_DISABLED=true` desliga.

## Fora de escopo (decisões conscientes)

- **GS1 Brasil** — só se o dono virar associado da GS1 e obter credenciais OAuth. Aí vira um provider separado (fluxo OAuth), plano à parte.
- **NCM/tributação da DotCompany na emissão fiscal** — a resposta traz NCM/IBPTAX; poderia alimentar a NFC-e no futuro. Guardamos `ncm` no cache, mas não ligamos ao fiscal agora.
