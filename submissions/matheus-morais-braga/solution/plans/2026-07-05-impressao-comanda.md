# Impressão de comanda / recibo (Nível 1 navegador → Nível 2 ESC/POS → Nível 3 cozinha)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 1, Onda A).

**Goal:** dar ao Caixa a capacidade de **emitir um cupom/recibo** ao fechar (ou reimprimir do
extrato) uma comanda. Hoje fechar só vira o status para `FECHADA` e **nada é emitido** — é a maior
lacuna isolada para uso de balcão. A entrega é em **três níveis**, do mais barato/universal ao mais
completo, porque cada negócio precisa de um diferente:
- **N1 (navegador):** recibo HTML dimensionado para bobina 80/58mm + `window.print()`. Funciona com
  **qualquer** impressora que o SO enxerga (Bematech MP-4200 TH, Elgin i9, Epson TM-T20 instalam como
  impressora comum) e até numa laser A4. Zero SDK de hardware.
- **N2 (ESC/POS):** corte automático, abertura de gaveta e impressão silenciosa via **QZ Tray**.
- **N3 (cozinha):** roteia itens por setor (cozinha/bar/balcão) — a "comanda de produção".

**Architecture:** o coração é uma **função pura** `buildReceiptModel(order, business)` que produz um
**modelo de recibo** estruturado (cabeçalho, linhas de item, totais, pagamento, rodapé). Dois
renderizadores consomem o mesmo modelo: `ReceiptDocument.tsx` (HTML/React, N1) e `escpos.ts`
(bytes ESC/POS, N2). Isso mantém a formatação testável e uma só fonte de verdade para os dois
caminhos. A impressão N1 usa um `<iframe>` oculto que carrega uma **rota standalone**
`/recibo/[orderId]` (fora do layout do app, sem sidebar) e chama `print()` — sem navegar para fora do
Caixa. A reimpressão no extrato abre a mesma rota.

**Tech Stack:** Next.js (App Router, RSC + client) · Prisma · Zod · TailwindCSS · Vitest
(`*.test.ts` co-locado) · CSS `@media print` · (N2) QZ Tray via WebSocket.

**Escopo (o que NÃO entra):** nota/cupom **fiscal** (NFC-e/SAT) — é a iniciativa 13, via emissor
terceiro; QR code de Pix no cupom (fast-follow); múltiplas vias configuráveis (N1 imprime 1 via).

**Decisões de produto:**
- **N1 primeiro e sempre disponível** — cobre a maioria sem instalar nada. N2/N3 são opt-in por conta.
- **Reimpressão** é ler `Order`+itens e re-renderizar — cupom não é imutável armazenado, é derivado
  (igual o total). Os snapshots de `OrderItem` (nome/preço) já garantem fidelidade histórica.
- **Número do cupom:** `Order.number` sequencial **por conta**, atribuído no fechamento. Enquanto
  nulo (comandas antigas), o recibo cai no id curto.
- **Layout:** monoespaçado, 32 colunas (80mm) / 24 colunas (58mm), sem depender de fontes externas.

---

## Contexto do código existente (leia antes de começar)

- **Fechamento da comanda:** [order.service.ts](../../src/server/services/order.service.ts) —
  `orderTotalCents` (~L17, total **derivado** dos itens), `openOrder` (~L53), `closeOrder` (~L131,
  `updateMany` atômico guardado em `status=ABERTA`, seta `closedAt`, chama `applyOrderStockExit`).
- **API de fechamento:** [orders/[id]/route.ts](../../src/app/api/vendas/orders/[id]/route.ts) —
  `PATCH` com `closeSchema` (~L20). É o ponto onde o `number` é atribuído.
- **UI do POS:** [OrderBoard.tsx](../../src/components/vendas/OrderBoard.tsx) — `OrderPanel` (~L365),
  botão de fechar (~L607). O botão "Imprimir" entra aqui e no card de comanda recém-fechada.
- **Extrato:** [SalesHistoryPanel.tsx](../../src/components/vendas/SalesHistoryPanel.tsx) e
  [sales-history.service.ts](../../src/server/services/sales-history.service.ts) — lista de comandas
  fechadas; ganha a ação "Reimprimir".
- **Dinheiro:** [money.ts](../../src/lib/money.ts) — `formatCentsBRL`/`parseBRLToCents`, só na borda.
- **Model:** [schema.prisma:282-303](../../prisma/schema.prisma#L282-L303) — `Order` (ganha `number`),
  `OrderItem` (`nameSnapshot`, `unitPriceCents`, `quantity`). `CatalogItem` (~L255) ganha `printSector`
  (N3).
- **Empresa/branding p/ o cabeçalho:** [branding.service.ts](../../src/server/services/branding.service.ts)
  (`appName`, `logoUrl`) e a config do número (`displayName`, `businessHours`, endereço via
  `knowledgeBase` — no MVP do cabeçalho use `appName`/`displayName`).
- **PROD schema drift** ([[prod-schema-drift-destravar]]): `Order.number` e `CatalogItem.printSector`
  entram na **Onda A** — SQL manual idempotente (ver Task N1.1 Step 5 e Fase N3).

---

## Visão geral das fases

- **Fase N1** — Recibo no navegador: modelo puro + renderizador HTML + rota standalone + botões
  Imprimir/Reimprimir + `Order.number`. **Entregável e suficiente sozinho.**
- **Fase N2** — ESC/POS via QZ Tray: renderizador de bytes + integração opt-in + comando de gaveta.
- **Fase N3** — Comanda de cozinha: `CatalogItem.printSector` + roteamento por setor + botão "Enviar
  para produção".

Cada fase é entregável e reversível de forma independente. **Só a N1 já destrava o balcão.**

---

# FASE N1 — Recibo no navegador

## Task N1.1: `Order.number` no schema (sequencial por conta)

**Files:**
- Modify: `prisma/schema.prisma` (model `Order`)
- Create: (migration dev via `db push`) + `prisma/manual/2026-07-05-onda-a.sql` (idempotente p/ PROD)

**Step 1: Adicione o campo**

Em `Order`, junto de `closedAt`:

```prisma
  number Int? // nº sequencial do cupom POR conta; atribuído no fechamento (null = comanda antiga)

  @@unique([accountId, number]) // sequencial por conta; NULLs coexistem (Postgres trata como distintos)
```

**Step 2: push dev**

> ⚠️ Pare o `next dev` antes ([[prisma-generate-dev-server-lock]] — EPERM no Windows).

Run: `npx prisma db push && npx prisma generate`

**Step 3: SQL manual idempotente (PROD — Onda A)**

Crie `prisma/manual/2026-07-05-onda-a.sql` (este arquivo acumula as mudanças da Onda A —
POS financeiro adiciona as dele aqui também):

```sql
-- Onda A — impressão + POS financeiro. Idempotente.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "number" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_accountId_number_key" ON "Order"("accountId","number");
```

(Aplicado no Supabase SQL Editor pelo dono — env do DB é Sensitive, não alcança daqui.)

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/manual/2026-07-05-onda-a.sql
git commit -m "feat(caixa): Order.number sequencial por conta (nº do cupom)"
```

---

## Task N1.2: Modelo puro do recibo (`buildReceiptModel`) — TDD

**Files:**
- Create: `src/lib/receipt/model.ts`
- Test: `src/lib/receipt/model.test.ts`

**Contexto:** função **pura**, sem I/O, que traduz uma comanda num modelo de recibo consumido pelos
dois renderizadores (HTML e ESC/POS). Recebe já os dados carregados (order + itens + dados da
empresa) e devolve blocos estruturados. Aqui mora a lógica de largura de coluna, alinhamento de
preço à direita, e a quebra de nome longo — tudo testável.

**Step 1: Write the failing test**

```ts
import { buildReceiptModel } from "./model";

const business = { name: "Barbearia Style", subtitle: "Seg–Sáb 9h–20h", width: 32 as const };
const order = {
  number: 42,
  id: "ckxyz123",
  customerName: "João",
  closedAt: new Date("2026-07-05T14:30:00-03:00"),
  payment: "DINHEIRO" as const,
  items: [
    { nameSnapshot: "Corte masculino", quantity: 1, unitPriceCents: 4000 },
    { nameSnapshot: "Barba", quantity: 2, unitPriceCents: 2500 },
  ],
};

describe("buildReceiptModel", () => {
  it("cabeçalho traz nome e nº do cupom", () => {
    const m = buildReceiptModel(order, business);
    expect(m.header.title).toBe("Barbearia Style");
    expect(m.header.docNumber).toBe("Cupom #42");
  });

  it("linhas somam qtd×preço e alinham o valor", () => {
    const m = buildReceiptModel(order, business);
    const barba = m.lines.find((l) => l.name.startsWith("Barba"));
    expect(barba?.totalCents).toBe(5000); // 2 × 2500
    // largura total respeita a coluna (32)
    expect(m.lines.every((l) => l.rendered.length <= 32)).toBe(true);
  });

  it("total do rodapé = soma das linhas", () => {
    const m = buildReceiptModel(order, business);
    expect(m.totals.totalCents).toBe(4000 + 5000);
  });

  it("cai no id curto quando number é null", () => {
    const m = buildReceiptModel({ ...order, number: null }, business);
    expect(m.header.docNumber).toBe("Comanda ckxyz123".slice(0, 20));
  });
});
```

**Step 2: Run test → FAIL** (`buildReceiptModel` não existe).

Run: `npx vitest run src/lib/receipt/model.test.ts`

**Step 3: Write minimal implementation**

`src/lib/receipt/model.ts` — tipos + a função pura. Use `formatCentsBRL` de `@/lib/money` só para
formatar strings de valor. Estruture blocos: `header`, `lines`, `totals`, `payment`, `footer`.
Implemente a largura de coluna (`business.width`, 32 ou 24), alinhamento à direita do valor e a
quebra de nome que exceda a coluna. **Não** faça I/O aqui.

**Step 4: Run test → PASS.**

**Step 5: Commit**

```bash
git add src/lib/receipt/model.ts src/lib/receipt/model.test.ts
git commit -m "feat(caixa): buildReceiptModel — modelo puro do recibo (testado)"
```

---

## Task N1.3: Carregar dados do recibo (serviço)

**Files:**
- Modify: `src/server/services/order.service.ts` (nova `getReceiptData(accountId, orderId)`)
- Test: `src/server/services/order.service.test.ts` (integração)

**Step 1:** escreva `getReceiptData` que carrega a comanda **escopada por conta** (`accountId =
ctx.tenantUserId`), com `items`, `number`, `customerName`, `closedAt`, `payment`, e os dados da
empresa (appName/displayName do branding/número). Lança se a comanda não é da conta. Retorna o
objeto no formato que `buildReceiptModel` espera (não chama o model aqui — separação I/O × pura).

**Step 2:** teste de integração — cria dono + comanda fechada, chama `getReceiptData`, confere que
traz os itens e o `number`; confere que comanda de outra conta é recusada.

**Step 3: Commit**

```bash
git add src/server/services/order.service.ts src/server/services/order.service.test.ts
git commit -m "feat(caixa): getReceiptData (carrega comanda p/ o recibo, escopado)"
```

---

## Task N1.4: Renderizador HTML + rota standalone `/recibo/[orderId]`

**Files:**
- Create: `src/components/vendas/ReceiptDocument.tsx` (client — recebe o `ReceiptModel`)
- Create: `src/app/recibo/[orderId]/page.tsx` (RSC — auth, carrega, renderiza)
- Create: `src/app/recibo/layout.tsx` (layout mínimo, **sem** Sidebar)
- Create: `src/app/recibo/[orderId]/AutoPrint.tsx` (client — chama `print()` se `?print=1`)

**Contexto:** rota **fora** do grupo `(app)` para não herdar a sidebar. Renderiza o recibo em bloco
único de largura fixa (80mm ≈ 302px / 58mm ≈ 219px) com CSS `@media print` que zera margens e esconde
tudo que não seja o recibo. `?print=1` dispara a impressão automática ao montar.

**Step 1:** `layout.tsx` mínimo — só `{children}`, com uma classe que ativa `@media print` global
(margens 0, `size: 80mm auto`). Aceita `?w=58` para a bobina estreita.

**Step 2:** `page.tsx` (RSC) — `getTenantContext()` (401→login), `getReceiptData`, `buildReceiptModel`
com `width` conforme `?w`, renderiza `<ReceiptDocument model={...} />` + `<AutoPrint />`.

**Step 3:** `ReceiptDocument.tsx` — mapeia o `ReceiptModel` para JSX monoespaçado (`font-mono`,
`whitespace-pre`), respeitando os tokens do tema mas **forçando fundo branco/texto preto na
impressão** ([[design-tokens-dark-theme]] — no `@media print` fixe as cores, papel é sempre claro).

**Step 4:** `AutoPrint.tsx` — `useEffect` que, se `new URLSearchParams(location.search).get("print")`,
chama `window.print()` (com um `setTimeout(…, 200)` p/ garantir layout pronto).

**Step 5: verificação visual**

Run: `npm run dev` (pare depois). Abra `/recibo/<id de uma comanda fechada>?print=1` → aparece o
recibo em coluna estreita e o diálogo de impressão abre. Teste `?w=58`.

**Step 6: Commit**

```bash
git add src/app/recibo src/components/vendas/ReceiptDocument.tsx
git commit -m "feat(caixa): rota /recibo/[orderId] + renderizador HTML do cupom (N1)"
```

---

## Task N1.5: Atribuir `Order.number` no fechamento

**Files:**
- Modify: `src/server/services/order.service.ts` (`closeOrder`)
- Test: `src/server/services/order.service.test.ts`

**Contexto:** o `number` é sequencial por conta, atribuído **dentro da transação** de fechamento
(mesmo lugar que seta `closedAt` e dá baixa de estoque), para não haver cupom sem número.

**Step 1: Write the failing test** — fecha duas comandas da mesma conta e espera `number` 1 e 2;
comandas de contas diferentes têm sequências independentes.

**Step 2:** implemente dentro da transação de `closeOrder`: `next = (max(number) da conta) + 1`
(via `aggregate`/`findFirst orderBy number desc` na mesma tx), grava no `update`. O `@@unique`
protege contra corrida (em colisão rara, refaz — ou serialize a tx). Documente o trade-off no comentário.

**Step 3: Run test → PASS.**

**Step 4: Commit**

```bash
git add src/server/services/order.service.ts src/server/services/order.service.test.ts
git commit -m "feat(caixa): numeração sequencial do cupom no fechamento"
```

---

## Task N1.6: Botão "Imprimir" no fechamento + "Reimprimir" no extrato

**Files:**
- Modify: `src/components/vendas/OrderBoard.tsx` (após fechar, e no card fechado)
- Modify: `src/components/vendas/SalesHistoryPanel.tsx` (ação por linha)
- Create: `src/lib/receipt/print-client.ts` (helper `printReceipt(orderId, width?)`)

**Contexto:** impressão **sem sair do Caixa** — um `<iframe>` oculto carrega `/recibo/[id]?print=1` e
o próprio `AutoPrint` dispara. Fallback: `window.open` se o iframe falhar. O mesmo helper serve
fechamento e reimpressão.

**Step 1:** `print-client.ts` — `printReceipt(orderId, width = 80)`: cria/reutiliza um `iframe`
oculto com `src=/recibo/${orderId}?print=1&w=${width}`, remove após o `afterprint`. Documente que em
kiosk (`chrome --kiosk-printing`) não abre diálogo.

**Step 2:** no `OrderBoard`, ao fechar com sucesso, mostre um botão/toast "Imprimir cupom" que chama
`printReceipt(order.id)`. Não imprima automático (o operador escolhe 80/58 e evita impressão
acidental) — mas deixe a preferência de largura na conta como fast-follow.

**Step 3:** no `SalesHistoryPanel`, adicione a ação "Reimprimir" por linha → `printReceipt(row.id)`.

**Step 4: verificação E2E** — fecha uma comanda → clica Imprimir → diálogo com o cupom certo;
no extrato → Reimprimir da mesma → cupom idêntico.

**Step 5: Commit**

```bash
git add src/components/vendas/OrderBoard.tsx src/components/vendas/SalesHistoryPanel.tsx src/lib/receipt/print-client.ts
git commit -m "feat(caixa): imprimir cupom no fechamento e reimprimir do extrato (N1)"
```

---

## Verificação de ponta a ponta da Fase N1

1. Fechar uma comanda com 2+ itens (um com qtd>1) → botão Imprimir → cupom em 80mm com nome da
   empresa, `Cupom #N`, itens alinhados, total = soma, forma de pagamento, data/hora.
2. `?w=58` → mesma coisa em coluna estreita.
3. Reimprimir do extrato → idêntico.
4. Comanda antiga (`number` null) → cai no id curto, sem quebrar.
5. `npx vitest run src/lib/receipt src/server/services/order.service.test.ts` verde + `npx tsc --noEmit`.
6. PROD: aplicar `2026-07-05-onda-a.sql`, abrir `/recibo/<id>` sem 500.

> **Fim da N1 = balcão já emite cupom em qualquer impressora.** N2/N3 são incrementos opt-in.

---

# FASE N2 — ESC/POS via QZ Tray (corte, gaveta, silencioso)

**Objetivo:** para quem opera volume — corte automático de papel, **abertura de gaveta de dinheiro**
e impressão sem diálogo. Requer o app **QZ Tray** instalado no PC do caixa (custo de onboarding).
Opt-in por conta.

## Task N2.1: Renderizador ESC/POS a partir do modelo puro — TDD
- Create `src/lib/receipt/escpos.ts` + teste. Consome o **mesmo** `ReceiptModel` da N1 e emite bytes
  ESC/POS: init (`ESC @`), alinhamentos, negrito no título, linhas, corte (`GS V`), e o pulso de
  gaveta (`ESC p 0 …`). Teste valida sequências de bytes-chave (init, corte, pulso) — pura, sem hardware.

## Task N2.2: Ponte QZ Tray (cliente) + config opt-in
- Create `src/lib/receipt/qz-client.ts` — conecta no QZ Tray (WebSocket local), lista impressoras,
  envia os bytes raw. `WhatsAppNumber`/conta ganha config opt-in `printMode` (`browser`|`escpos`) e
  `printerName`. Quando `escpos`, `printReceipt` roteia para o QZ em vez do iframe.
- Sem schema pesado: guardar `printMode`/`printerName`/`openDrawer` em `AccountBranding` ou numa nova
  `AccountPosSettings` (decidir no início da fase; provavelmente estender branding/settings).

## Task N2.3: Abertura de gaveta no pagamento em dinheiro
- Quando `openDrawer` ligado e pagamento inclui dinheiro, envia o pulso junto do cupom.

**Verificação N2:** com QZ Tray rodando e uma térmica ESC/POS, fechar comanda → corta o papel
sozinho e (se ligado) abre a gaveta. Fallback para N1 quando o QZ não está disponível.

---

# FASE N3 — Comanda de cozinha (roteamento por setor)

**Objetivo:** restaurante/lanchonete/pizzaria — imprimir a **comanda de produção** separada do
recibo do cliente, roteando itens para a impressora do setor (cozinha/bar). Depende de o cliente ter
N1 ou N2 e faz mais sentido **após** o POS financeiro (o cupom mostra desconto/observações).

## Task N3.1: `CatalogItem.printSector` no schema (Onda A)
- `printSector String?` (ex.: "cozinha", "bar", "balcao"). SQL idempotente no `2026-07-05-onda-a.sql`:
  `ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "printSector" TEXT;`

## Task N3.2: Modelo de comanda de produção — TDD
- `buildKitchenTickets(order)` puro: agrupa itens por `printSector`, gera **um ticket por setor**
  (sem preços — produção não quer valor; traz qtd, nome, observação do item/comanda). Teste valida o
  agrupamento e a ausência de valores.

## Task N3.3: Botão "Enviar para produção" + roteamento
- No `OrderPanel`, ação que imprime os tickets de cozinha (N1: um iframe por setor; N2: um job QZ por
  impressora de setor). Config de "impressora por setor" na conta (mapa setor→printerName).

**Verificação N3:** comanda com item de cozinha + item de bar → dois tickets, cada um só com os
itens do seu setor, sem preço.

---

## Riscos e notas

- **N1 é universal**, N2/N3 dependem de app local (QZ Tray) e impressora ESC/POS — vira custo de
  onboarding; por isso N1 nunca é removido e é o default.
- **Cores na impressão:** papel é sempre claro — no `@media print` fixe fundo branco/texto preto,
  ignorando o tema dark ([[design-tokens-dark-theme]]).
- **Corrida no `Order.number`:** protegida pelo `@@unique([accountId, number])`; em colisão rara,
  reexecutar o cálculo. Não desnormalizar/adiantar o número na abertura (comanda cancelada deixaria
  buraco na sequência — atribuir só no fechamento).
- **Kiosk printing:** para eliminar o diálogo em N1, orientar o cliente a rodar o Chrome do caixa com
  `--kiosk-printing` (documentar no onboarding). Sem isso, é 1 clique a mais.
- **Fiscal ≠ recibo:** este cupom **não** é documento fiscal. NFC-e/SAT é a iniciativa 13, via
  emissor terceiro, opt-in — não confundir na comunicação com o cliente.
- **PROD:** `Order.number` e `CatalogItem.printSector` entram na Onda A idempotente; não duplicar com
  migration versionada ([[prod-schema-drift-destravar]]).
```
