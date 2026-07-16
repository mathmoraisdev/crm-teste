# Estoque na IA de Atendimento — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fazer a IA de atendimento marcar itens do catálogo como INDISPONÍVEL quando estão sem estoque, para que ela não ofereça produtos esgotados.

**Architecture:** O bloco de catálogo já é injetado automaticamente no prompt de atendimento (`renderCatalogForAI`). O dado de estoque (`trackStock`, `stockQty`) já sai do banco em `listCatalogItems()` mas é descartado antes de chegar ao render. A mudança é: (1) parar de descartar esses campos, (2) marcar "INDISPONÍVEL" no render quando `trackStock && stockQty <= 0`, (3) instruir o system prompt a não ofertar itens marcados assim. **Zero migração de banco** — os campos já existem no schema e no DTO.

**Decisão de escopo (v1):** marcar apenas **disponível vs esgotado**. NÃO expor a quantidade numérica ao cliente. Item só é marcado quando `trackStock === true` (opt-in por produto) E `stockQty <= 0` (estoque pode ser negativo — regra do módulo de estoque).

**Tech Stack:** TypeScript, Vitest (`npm test` → `vitest run`), Prisma. Funções puras em `src/server/ai/attendance-context.ts`.

---

## Contexto para quem for implementar (leia antes)

Fluxo do dado, ponta a ponta:

1. `listCatalogItems(accountId, { activeOnly: true })` — `src/server/services/catalog.service.ts:63` — retorna `CatalogItemDTO[]`, que **já inclui** `trackStock: boolean` e `stockQty: number` (ver interface em `catalog.service.ts:6-17`).
2. `loadCatalogBlock(accountId)` — `src/server/services/conversation.service.ts:621-625` — mapeia os itens e chama `renderCatalogForAI`. **É AQUI que hoje `trackStock`/`stockQty` são jogados fora** (linha 623 só passa `name`, `priceCents`, `kind`).
3. `renderCatalogForAI(items)` — `src/server/ai/attendance-context.ts:55-62` — renderiza o bloco de texto que vai pro prompt.
4. `generateAttendanceReply(...)` — `src/server/ai/conversation.agent.ts:85` — injeta o bloco no prompt (mas NÃO quando há `systemPromptOverride` — ver linha 104; isso é por design e **não muda** neste plano).

Ponto importante: `loadCatalogBlock` é chamado em **dois** lugares — resposta automática (`conversation.service.ts:597`) e rascunho "Sugerir resposta" (`conversation.service.ts:673`). Corrigir `loadCatalogBlock` cobre os dois de uma vez.

Formato atual de cada linha do bloco: `- Nome: R$ XX,XX` (ou `- Nome: sob consulta` quando `priceCents === 0`).
Formato alvo do item esgotado: `- Nome: R$ XX,XX — INDISPONÍVEL (sem estoque)`.

---

## Task 1: Render marca itens esgotados

**Files:**
- Modify: `src/server/ai/attendance-context.ts:44-62` (interface `CatalogItemForContext` + função `renderCatalogForAI`)
- Test: `src/server/ai/attendance-context.test.ts:42-61` (bloco `describe("renderCatalogForAI")`)

### Step 1: Escrever os testes que falham

No arquivo `src/server/ai/attendance-context.test.ts`, DENTRO do `describe("renderCatalogForAI", ...)` existente, adicione estes `it(...)` logo após o teste "respeita o teto de itens" (antes do `})` que fecha o describe, linha ~60):

```ts
  it("marca INDISPONÍVEL quando trackStock e estoque <= 0", () => {
    const out = renderCatalogForAI([
      { name: "Camiseta P", priceCents: 5000, kind: "PRODUTO", trackStock: true, stockQty: 0 },
    ]);
    expect(out).toMatch(/Camiseta P.*R\$ 50,00.*INDISPON[IÍ]VEL/i);
  });

  it("marca INDISPONÍVEL também com estoque negativo", () => {
    const out = renderCatalogForAI([
      { name: "Camiseta M", priceCents: 5000, kind: "PRODUTO", trackStock: true, stockQty: -3 },
    ]);
    expect(out).toMatch(/Camiseta M.*INDISPON[IÍ]VEL/i);
  });

  it("NÃO marca quando há estoque", () => {
    const out = renderCatalogForAI([
      { name: "Camiseta G", priceCents: 5000, kind: "PRODUTO", trackStock: true, stockQty: 7 },
    ]);
    expect(out).not.toMatch(/INDISPON[IÍ]VEL/i);
  });

  it("NÃO marca quando trackStock é false (mesmo com stockQty 0)", () => {
    const out = renderCatalogForAI([
      { name: "Corte de Cabelo", priceCents: 4000, kind: "SERVICO", trackStock: false, stockQty: 0 },
    ]);
    expect(out).not.toMatch(/INDISPON[IÍ]VEL/i);
  });

  it("NÃO expõe a quantidade numérica", () => {
    const out = renderCatalogForAI([
      { name: "Boné", priceCents: 3000, kind: "PRODUTO", trackStock: true, stockQty: 42 },
    ]);
    expect(out).not.toContain("42");
  });

  it("itens sem campos de estoque continuam funcionando (retrocompat)", () => {
    const out = renderCatalogForAI([{ name: "Combo", priceCents: 2500, kind: "PRODUTO" }]);
    expect(out).toContain("Combo");
    expect(out).not.toMatch(/INDISPON[IÍ]VEL/i);
  });
```

### Step 2: Rodar os testes e confirmar que falham

Run: `npx vitest run src/server/ai/attendance-context.test.ts`
Expected: FALHA. Os testes novos que passam `trackStock`/`stockQty` vão dar erro de tipo (TS: campos não existem em `CatalogItemForContext`) e/ou assert de INDISPONÍVEL falha porque o render ainda não marca nada.

### Step 3: Estender a interface

Em `src/server/ai/attendance-context.ts`, substitua a interface `CatalogItemForContext` (linhas 44-48) por:

```ts
export interface CatalogItemForContext {
  name: string;
  priceCents: number;
  kind: "SERVICO" | "PRODUTO";
  /** Opcionais: quando ausentes, o item é sempre tratado como disponível (retrocompat). */
  trackStock?: boolean;
  stockQty?: number;
}
```

### Step 4: Marcar esgotado no render

Em `src/server/ai/attendance-context.ts`, substitua o corpo de `renderCatalogForAI` (linhas 55-62) por:

```ts
export function renderCatalogForAI(items: CatalogItemForContext[], limit = 40): string {
  if (!items.length) return "";
  const lines = items.slice(0, limit).map((i) => {
    const price = i.priceCents > 0 ? formatCentsBRL(i.priceCents) : "sob consulta";
    // Só marca esgotado quando o item controla estoque (opt-in) e zerou/negativou.
    // NÃO expõe a quantidade — só disponível vs indisponível (decisão v1).
    const soldOut = i.trackStock && (i.stockQty ?? 0) <= 0;
    const mark = soldOut ? " — INDISPONÍVEL (sem estoque)" : "";
    return `- ${i.name}: ${price}${mark}`;
  });
  return `SERVIÇOS E PRODUTOS (catálogo da empresa; informe preço só se listado):\n${lines.join("\n")}`;
}
```

### Step 5: Rodar os testes e confirmar que passam

Run: `npx vitest run src/server/ai/attendance-context.test.ts`
Expected: PASS (todos, incluindo os antigos — a mudança é retrocompatível).

### Step 6: Commit

```bash
git add src/server/ai/attendance-context.ts src/server/ai/attendance-context.test.ts
git commit -m "feat(ia): marca item do catálogo como INDISPONÍVEL quando sem estoque"
```

---

## Task 2: Parar de descartar trackStock/stockQty no loadCatalogBlock

**Files:**
- Modify: `src/server/services/conversation.service.ts:621-625` (função `loadCatalogBlock`)

**Nota:** Este é um `.map` interno numa função de serviço que toca banco. Não há teste unitário isolado pra ela (depende de Prisma). A validação de comportamento é feita na Task 3 (teste de integração do render via `generateAttendanceReply`) + typecheck. Portanto aqui NÃO escrevemos teste unitário novo; confiamos no typecheck + Task 3.

### Step 1: Passar os campos adiante

Em `src/server/services/conversation.service.ts`, na função `loadCatalogBlock` (linhas 621-625), substitua a linha 623:

```ts
  const block = renderCatalogForAI(items.map((i) => ({ name: i.name, priceCents: i.priceCents, kind: i.kind })));
```

por:

```ts
  const block = renderCatalogForAI(
    items.map((i) => ({
      name: i.name,
      priceCents: i.priceCents,
      kind: i.kind,
      trackStock: i.trackStock,
      stockQty: i.stockQty,
    })),
  );
```

### Step 2: Typecheck / build parcial

Run: `npx tsc --noEmit`
Expected: sem erros novos. (`i.trackStock` e `i.stockQty` existem no `CatalogItemDTO`, então compila.)

Se o projeto não tiver `tsc` configurado standalone, rode a suíte inteira como proxy:
Run: `npm test`
Expected: PASS.

### Step 3: Commit

```bash
git add src/server/services/conversation.service.ts
git commit -m "feat(ia): injeta status de estoque do catálogo no contexto de atendimento"
```

---

## Task 3: Teste de integração — a IA "vê" o INDISPONÍVEL no prompt

**Files:**
- Modify: `src/server/ai/conversation.agent.catalog.verify.test.ts` (arquivo de verificação já existente para catálogo)

**Objetivo:** garantir que, ponta a ponta pelo `generateAttendanceReply`, um item esgotado chega ao prompt marcado, e que no modo `systemPromptOverride` o catálogo (e portanto o estoque) continua NÃO sendo injetado.

### Step 1: Ler o arquivo de teste existente para casar o padrão de mock

Run: `cat src/server/ai/conversation.agent.catalog.verify.test.ts`
Observe como o `ai` (AiClient) é mockado e como o teste captura o `user` prompt enviado ao modelo (provavelmente via um spy em `generateText` que guarda os argumentos). **Reuse exatamente esse mesmo mecanismo** — não invente um novo mock.

### Step 2: Escrever o teste que falha

Adicione ao final do arquivo (dentro do mesmo `describe`, ou um novo `describe("estoque")`), seguindo o padrão de mock observado no Step 1. Esqueleto (ajuste os nomes do mock ao que o arquivo já usa):

```ts
  it("injeta item esgotado marcado como INDISPONÍVEL no prompt", async () => {
    const catalogBlock = renderCatalogForAI([
      { name: "Tênis Runner", priceCents: 29900, kind: "PRODUTO", trackStock: true, stockQty: 0 },
    ]);
    // <capturar o user prompt via o mesmo spy que o arquivo já usa>
    await generateAttendanceReply({
      ai, // mock existente no arquivo
      company: { displayName: "Loja X" },
      catalogBlock,
      conversation: [{ role: "lead", text: "tem o tênis runner?" }], // ajuste ao tipo ConversationTurn real
    });
    // expect(<user prompt capturado>).toMatch(/Tênis Runner.*INDISPON[IÍ]VEL/i);
  });

  it("modo systemPromptOverride NÃO injeta o catálogo (nem estoque)", async () => {
    const catalogBlock = renderCatalogForAI([
      { name: "Tênis Runner", priceCents: 29900, kind: "PRODUTO", trackStock: true, stockQty: 0 },
    ]);
    await generateAttendanceReply({
      ai,
      company: { displayName: "Loja X", systemPromptOverride: "Você é o atendente da Loja X. Responda tudo." },
      catalogBlock,
      conversation: [{ role: "lead", text: "tem o tênis?" }],
    });
    // expect(<user prompt capturado>).not.toContain("INDISPONÍVEL");
    // expect(<user prompt capturado>).not.toContain("Tênis Runner");
  });
```

> Importante: os campos exatos de `ConversationTurn` e a forma de capturar o prompt devem vir do que o arquivo já faz (Step 1). Não presuma a assinatura — copie do teste vizinho.

### Step 3: Rodar e confirmar que falha (antes) / passa (depois)

Run: `npx vitest run src/server/ai/conversation.agent.catalog.verify.test.ts`
Expected antes das mudanças das Tasks 1-2: o primeiro teste falharia. Como Tasks 1-2 já foram feitas, aqui o esperado é: escrever o teste, rodar, e ele PASSAR direto (validando o comportamento acumulado). Se o teste de override falhar, revisar `conversation.agent.ts:104` — mas ele já deve estar correto (não mexemos nele).

### Step 4: Commit

```bash
git add src/server/ai/conversation.agent.catalog.verify.test.ts
git commit -m "test(ia): verifica estoque INDISPONÍVEL no prompt e supressão no modo override"
```

---

## Task 4: Instruir o system prompt a respeitar o INDISPONÍVEL

**Files:**
- Modify: `src/server/ai/prompts.ts:46-57` (`ATTENDANCE_SYSTEM`)

**Por quê:** marcar o item no bloco não basta — o modelo precisa de instrução explícita para não ofertar itens esgotados e avisar o cliente. Sem isso ele pode ignorar o marcador.

### Step 1: Adicionar a regra

Em `src/server/ai/prompts.ts`, dentro de `ATTENDANCE_SYSTEM`, adicione um bullet novo na lista de regras (após a linha 52, a que fala de "Nunca invente preços, prazos ou políticas."):

```
- Itens marcados como "INDISPONÍVEL (sem estoque)" no catálogo NÃO devem ser oferecidos: se o cliente pedir um deles, avise gentilmente que está sem estoque no momento e, se fizer sentido, ofereça uma alternativa disponível do catálogo. Nunca prometa prazo de reposição que não foi informado.
```

### Step 2: Rodar a suíte inteira (garantir que nada quebrou)

Run: `npm test`
Expected: PASS. (Nenhum teste faz assert sobre o texto exato de `ATTENDANCE_SYSTEM`; se algum fizer, ajuste-o para conter a nova regra.)

### Step 3: Commit

```bash
git add src/server/ai/prompts.ts
git commit -m "feat(ia): instrui atendente a não ofertar itens sem estoque"
```

---

## Task 5: Verificação manual end-to-end (opcional mas recomendada)

**Objetivo:** confirmar comportamento real, não só unit tests. Usar o smoke script de atendimento se aplicável.

### Step 1: Rodar o smoke de atendimento

Run: `npm run smoke:atendimento`
(Ver `scripts/smoke-atendimento.ts` — pode exigir env/DB. Se exigir conta real, pular e registrar que foi pulado.)

### Step 2: Checklist de sanidade manual

- [ ] Catálogo com item `trackStock: true, stockQty: 0` → bloco do prompt mostra `— INDISPONÍVEL (sem estoque)`.
- [ ] Mesmo item com `stockQty: 5` → sem marcador.
- [ ] Item `trackStock: false` → nunca marcado, qualquer estoque.
- [ ] Quantidade numérica (ex.: "5", "42") NÃO aparece no bloco.
- [ ] Número com `systemPromptOverride` → catálogo inteiro ausente do prompt (comportamento intencional).

### Step 3: Commit final (se houver ajustes)

```bash
git add -A
git commit -m "chore(ia): ajustes finais estoque no atendimento"
```

---

## Resumo de arquivos tocados

| Arquivo | Mudança |
|---|---|
| `src/server/ai/attendance-context.ts` | Interface + render marcam esgotado |
| `src/server/ai/attendance-context.test.ts` | Testes do render |
| `src/server/services/conversation.service.ts` | `loadCatalogBlock` passa `trackStock`/`stockQty` |
| `src/server/ai/conversation.agent.catalog.verify.test.ts` | Teste de integração (prompt + override) |
| `src/server/ai/prompts.ts` | Regra no `ATTENDANCE_SYSTEM` |

**Sem migração de banco. Sem alteração de schema Prisma. Sem restart especial de worker** (só deploy normal do worker/web após merge).

## Fora de escopo (v1 — não fazer agora)

- Expor quantidade numérica ("últimas 3 unidades").
- Marcador de "estoque baixo" via `minStock`.
- Injetar estoque no modo `systemPromptOverride` (intencionalmente mantido de fora).
- Ofertas (`renderActiveOffers`) — fluxo separado de qualificação/venda, não tocado aqui.
