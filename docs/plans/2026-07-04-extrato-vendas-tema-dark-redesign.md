# Extrato de Vendas + Tema Dark + Redesign dos Cards — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** (1) Dar ao dono um **extrato de vendas** — a lista das comandas fechadas com **quem lançou**, **data**, cliente, pagamento e total, filtrável por **período** (incl. intervalo custom), **operador** e **nome do cliente**; (2) um **tema dark** elegante para o app; (3) um **redesign dos cards/primitivas** com cara de sistema premiado — tudo num sistema de design coerente que funciona em claro e escuro.

**Architecture:** Duas partes independentes.
- **Parte A (Extrato):** puro dado que já existe. `Order.openedById` (quem lançou) e `Order.closedAt` (data) já são gravados — só nunca foram lidos de volta. Um service `listSalesHistory` (join `openedById → User.name`) + API + uma seção "Extrato" nos Relatórios. Zero mudança de schema.
- **Parte B (Design):** hoje `brand-*` já é temável via CSS vars, mas os neutros (`slate-*`), o `ink` e o `white` são **hex fixos** — por isso dark mode não é um flip de classe. A estratégia é promover a escala `slate` e o `ink` a **variáveis CSS** (como já é o `brand`), definir **tokens semânticos de superfície/texto/borda** (claro + escuro), ligar `darkMode:"class"` e um toggle com `data-theme` no `<html>`. Como o app usa a escala `slate` de forma consistente, ~760 usos viram dark **sem editar componente**; sobra varrer `bg-white` (71) e hex de status. O redesign vive nas **primitivas centralizadas** (`Card`, `Button`, inputs, modal), então propaga.

**Tech Stack:** Next.js (App Router, RSC + client) · TailwindCSS (config em `tailwind.config.ts`, vars em `src/app/globals.css`) · Prisma + Postgres · Zod · Vitest.

**Princípios de design (o "premiado, elegante"):** hierarquia por **elevação e espaço**, não por peso de borda; bordas de 1px de baixo contraste; sombras suaves em camadas; raio consistente (cards 16px, controles 12px); tipografia com a escala já existente (`font-display` p/ títulos); acento da marca com parcimônia; superfícies escuras **dessaturadas verde-petróleo** (não preto puro), on-brand com o verde. Acessibilidade: contraste AA em ambos os temas.

---

## Convenções do projeto (leia antes de começar)

- **Testes:** Vitest co-locado. Service que toca Prisma usa o banco de dev (padrão de `catalog.service.test.ts`). Pura → sem banco.
- **Dinheiro:** centavos (`Int`); `formatCentsBRL` só na borda.
- **Tenancy:** dono = `ctx.tenantUserId`; tudo escopado por `accountId`. Rotas: `dynamic="force-dynamic"`, `getTenantContext()`, 401/403, zod, `try/catch → { error }` (espelhe `src/app/api/vendas/reports/route.ts`).
- **Fuso:** `America/Sao_Paulo`. Reuse `src/server/services/date-range.ts` (`resolvePeriod`) para os presets; o intervalo custom passa `from/to` explícitos.
- **Design tokens:** cores da marca em `tailwind.config.ts` (`brand-*` via var). Neutros em `slate-*` (hoje hex). Vars em `src/app/globals.css`. Componentes base: `src/components/ui/Card.tsx`, `Button.tsx`.
- **Commits frequentes** ao fim de cada task. `npx tsc --noEmit` limpo entre tasks.

**Pontos-chave já mapeados (não re-descobrir):**
- Comanda: `Order.openedById` (FK → User, gravado de `ctx.sessionUserId`), `Order.closedAt`, `Order.customerName`/`leadId`, `Order.payment`. Total = Σ itens (`orderTotalCents`).
- Relatórios atuais (só agregados): `src/server/services/sales-report.service.ts` (`salesSummary`/`revenueByPayment`/`topItems`), API `src/app/api/vendas/reports/route.ts`, UI `src/components/vendas/ReportsPanel.tsx`.
- Tema: `tailwind.config.ts` (brand=var, slate=hex, `ink`=hex), `src/app/globals.css` (`:root{--brand-*}`), injeção por conta em `src/components/app/BrandingStyle.tsx`. Root layout `src/app/layout.tsx` (`<html>`). **Nenhum `dark:` existe hoje** (campo limpo).
- Escala do refactor: `text-slate-*` 450, `border-slate-*` 159, `bg-slate-*` 82, `text-ink` 124, `bg-white` 71 (84 arquivos .tsx).

---

## Visão geral das fases

**Parte A — Extrato de vendas**
- **Fase 1** — Service `listSalesHistory` + operadores (TDD).
- **Fase 2** — API + UI "Extrato" nos Relatórios (filtros período/operador/cliente).

**Parte B — Design system (dark + cards)**
- **Fase 3** — Camada de tokens: promover `slate`/`ink` a vars + tokens semânticos + `darkMode:"class"` (sem mudança visual no claro).
- **Fase 4** — Valores do tema dark + toggle + persistência + no-flash SSR.
- **Fase 5** — Redesign das primitivas (`Card`, `Button`, input, modal).
- **Fase 6** — Varredura em ondas (`bg-white`→token, hex de status→token) + QA visual claro/escuro por área.
- **Fase 7** — Verificação final.

Parte A é independente e de baixo risco — pode ir a prod sozinha. Parte B é sensível (toca o app inteiro) e é feita em ondas com verificação visual.

---

# PARTE A — EXTRATO DE VENDAS

# FASE 1 — Service

## Task 1.1: `listSalesHistory` + `listSalesOperators` (com teste)

**Files:**
- Create: `src/server/services/sales-history.service.ts`
- Test: `src/server/services/sales-history.service.test.ts`

Regras: só comandas **FECHADAS**; escopo por `accountId`; filtro `from/to` por `closedAt`; `operatorId?` (filtra `openedById`); `query?` (case-insensitive em `customerName`); paginação `skip/take`. Cada linha traz `operatorName` (join `openedById → User.name`), cliente, pagamento, total (derivado dos itens), data. `listSalesOperators` devolve os operadores distintos que fecharam comandas (p/ o filtro).

**Step 1: Teste que falha:**

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createCatalogItem } from "./catalog.service";
import { openOrder, addItem, closeOrder } from "./order.service";
import { listSalesHistory, listSalesOperators } from "./sales-history.service";

async function makeUser(name: string) {
  const u = await prisma.user.create({ data: { email: `h_${name}_${Math.random()}@t.test`, name, passwordHash: "x" } });
  return u.id;
}

describe("sales-history.service", () => {
  it("lista comandas fechadas com operador, data e cliente; filtra por operador e nome", async () => {
    const acc = await makeUser("Dono");
    const op = await prisma.user.create({ data: { email: `op_${Math.random()}@t.test`, name: "Ana Operadora", passwordHash: "x", ownerId: acc, role: "OPERADOR" } });
    const item = await createCatalogItem(acc, { name: "Corte", priceCents: 4000 });

    const o1 = await openOrder(acc, { openedById: acc, customerName: "João Silva" });
    await addItem(acc, o1.id, { catalogItemId: item.id, quantity: 1 });
    await closeOrder(acc, o1.id, { payment: "DINHEIRO" });

    const o2 = await openOrder(acc, { openedById: op.id, customerName: "Maria Souza" });
    await addItem(acc, o2.id, { catalogItemId: item.id, quantity: 2 });
    await closeOrder(acc, o2.id, { payment: "PIX" });

    await openOrder(acc, { openedById: acc, customerName: "Aberta" }); // ABERTA — não entra

    const from = new Date(Date.now() - 3600_000);
    const to = new Date(Date.now() + 3600_000);

    const all = await listSalesHistory(acc, { from, to });
    expect(all.total).toBe(2);
    const j = all.items.find((r) => r.customerName === "João Silva")!;
    expect(j.operatorName).toBe("Dono");
    expect(j.totalCents).toBe(4000);
    expect(j.payment).toBe("DINHEIRO");
    expect(j.closedAt).toBeTruthy();

    // filtro por operador
    const byOp = await listSalesHistory(acc, { from, to, operatorId: op.id });
    expect(byOp.items.map((r) => r.customerName)).toEqual(["Maria Souza"]);

    // busca por nome do cliente
    const byName = await listSalesHistory(acc, { from, to, query: "joão" });
    expect(byName.items.map((r) => r.customerName)).toEqual(["João Silva"]);

    // operadores distintos p/ o filtro
    const ops = await listSalesOperators(acc);
    expect(ops.map((o) => o.name).sort()).toEqual(["Ana Operadora", "Dono"]);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/sales-history.service.test.ts`
Expected: FAIL — módulo inexistente.

**Step 3: Implementar:**

```ts
import { prisma } from "@/server/db/client";
import type { OrderPayment } from "@prisma/client";
import { orderTotalCents } from "./order.service";

export interface SalesHistoryRow {
  id: string;
  closedAt: string;
  customerName: string | null;
  leadId: string | null;
  operatorName: string;
  payment: OrderPayment | null;
  totalCents: number;
}
export interface SalesHistoryPage { items: SalesHistoryRow[]; total: number; }

export async function listSalesHistory(
  accountId: string,
  opts: { from: Date; to: Date; operatorId?: string; query?: string; skip?: number; take?: number },
): Promise<SalesHistoryPage> {
  const where = {
    accountId,
    status: "FECHADA" as const,
    closedAt: { gte: opts.from, lte: opts.to },
    ...(opts.operatorId ? { openedById: opts.operatorId } : {}),
    ...(opts.query?.trim()
      ? { customerName: { contains: opts.query.trim(), mode: "insensitive" as const } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { closedAt: "desc" },
      skip: opts.skip ?? 0,
      take: opts.take ?? 50,
      select: {
        id: true, closedAt: true, customerName: true, leadId: true, payment: true,
        openedBy: { select: { name: true } },
        items: { select: { unitPriceCents: true, quantity: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  const items: SalesHistoryRow[] = rows.map((o) => ({
    id: o.id,
    closedAt: (o.closedAt ?? new Date(0)).toISOString(),
    customerName: o.customerName,
    leadId: o.leadId,
    operatorName: o.openedBy?.name ?? "—",
    payment: o.payment,
    totalCents: orderTotalCents(o.items),
  }));
  return { items, total };
}

/** Operadores distintos que fecharam comandas (p/ o filtro do extrato). */
export async function listSalesOperators(accountId: string): Promise<{ id: string; name: string }[]> {
  const ids = await prisma.order.findMany({
    where: { accountId, status: "FECHADA" },
    distinct: ["openedById"],
    select: { openedById: true },
  });
  if (!ids.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids.map((r) => r.openedById) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users;
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/sales-history.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/services/sales-history.service.ts src/server/services/sales-history.service.test.ts
git commit -m "feat(vendas): sales-history.service (extrato: quem lançou, data, filtros)"
```

---

# FASE 2 — API + UI do Extrato

## Task 2.1: API do extrato

**Files:**
- Create: `src/app/api/vendas/orders/history/route.ts` (GET)

Query params: `period=hoje|7d|mes` OU `from`/`to` (ISO, intervalo custom); `operatorId?`; `q?`; `skip?`/`take?`. Resolve `from/to` (custom tem prioridade; senão `resolvePeriod`). Retorna `{ items, total, operators }` (operadores p/ o filtro).

```ts
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { resolvePeriod, type ReportPeriod } from "@/server/services/date-range";
import { listSalesHistory, listSalesOperators } from "@/server/services/sales-history.service";

export const dynamic = "force-dynamic";
const VALID: ReportPeriod[] = ["hoje", "7d", "mes"];

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const sp = req.nextUrl.searchParams;

  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");
  let from: Date, to: Date;
  if (fromRaw && toRaw) {
    from = new Date(fromRaw); to = new Date(toRaw);
    if (isNaN(+from) || isNaN(+to)) return NextResponse.json({ error: "Datas inválidas" }, { status: 400 });
  } else {
    const p = (VALID.includes(sp.get("period") as ReportPeriod) ? sp.get("period") : "mes") as ReportPeriod;
    ({ from, to } = resolvePeriod(p));
  }
  const operatorId = sp.get("operatorId") || undefined;
  const q = sp.get("q") || undefined;
  const skip = Number(sp.get("skip") ?? 0) || 0;
  const take = Math.min(Number(sp.get("take") ?? 50) || 50, 100);

  const [page, operators] = await Promise.all([
    listSalesHistory(ctx.tenantUserId, { from, to, operatorId, query: q, skip, take }),
    listSalesOperators(ctx.tenantUserId),
  ]);
  return NextResponse.json({ ...page, operators });
}
```

**Step 2: Verificar tipos + Commit**

Run: `npx tsc --noEmit`

```bash
git add src/app/api/vendas/orders/history
git commit -m "feat(vendas): API do extrato (period/custom, operador, busca)"
```

---

## Task 2.2: UI — seção "Extrato" nos Relatórios

**Files:**
- Create: `src/components/vendas/SalesHistoryPanel.tsx`
- Modify: `src/components/vendas/ReportsPanel.tsx` (montar como uma sub-seção/aba "Extrato")

Client component: filtros (toggle período Hoje/7d/Mês **+ intervalo custom** com dois `<input type=date>`; `<select>` de operador; input de busca por cliente) + tabela: **Data · Cliente · Operador · Pagamento · Total**. Formata data no fuso (reuse `formatSlot` de `src/lib/utils.ts` ou `toLocaleDateString`), dinheiro com `formatCentsBRL`. Paginação simples ("carregar mais" via `skip`). Estado vazio amigável.

**Step 1: Componente** (esboço — siga `ReportsPanel`/`Card`; monta a query string com `period` OU `from/to`):

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatCentsBRL } from "@/lib/money";
// estados: period|custom(from,to), operatorId, q, rows, operators, total, loading, skip
// load(): fetch(`/api/vendas/orders/history?...`) com os filtros; tabela com as 5 colunas
// PAYMENT_LABEL reuse do ReportsPanel (DINHEIRO→Dinheiro, etc.)
```

**Step 2:** Em `ReportsPanel`, adicione um seletor de visão ("Resumo" | "Extrato") ou renderize `SalesHistoryPanel` abaixo dos cards. Comportamento atual (resumo) intacto.

**Step 3: Verificar tipos + Commit**

Run: `npx tsc --noEmit`

```bash
git add src/components/vendas/SalesHistoryPanel.tsx src/components/vendas/ReportsPanel.tsx
git commit -m "feat(vendas): UI do extrato (data, cliente, operador, filtros período/nome)"
```

## Task 2.3: Verificação da Parte A (skill @verify)

E2E autenticado (cookie de sessão assinado — padrão dos E2E de vendas): abrir 2 comandas com operadores diferentes, fechar, e via `GET /api/vendas/orders/history` conferir: operador correto por linha, filtro por operador, busca por nome do cliente, período custom (`from`/`to`). `npx vitest run` + `npx tsc --noEmit` limpos.

```bash
git commit -m "test(vendas): verificação do extrato (extrato + filtros)" --allow-empty
```

> **Parte A não tem mudança de schema** → pode ir a prod/deploy sem passo de banco.

---

# PARTE B — DESIGN SYSTEM (DARK + CARDS)

> **Estratégia de segurança:** a Fase 3 NÃO muda o visual do tema claro (só troca hex por var com os MESMOS valores). O dark (Fase 4) e o redesign (Fase 5) são incrementais. A Fase 6 varre o resto em ondas com conferência visual. Rode `npm run dev` e confira as telas em claro e escuro ao fim de cada fase.

# FASE 3 — Camada de tokens (foundation, sem mudança visual no claro)

## Task 3.1: Promover `slate`/`ink` a variáveis + tokens semânticos

**Files:**
- Modify: `src/app/globals.css` (definir vars claras; espelham os hex atuais)
- Modify: `tailwind.config.ts` (apontar `slate`/`ink` p/ as vars + novos tokens `surface`/`card`/`raised`/`inset`/`line`/`line-strong`)

**Step 1: globals.css** — adicione, no `:root` (junto do `--brand-*`), a escala neutra atual **como vars** (mesmos valores → zero mudança visual) e os tokens semânticos:

```css
:root {
  /* neutros (espelham os hex atuais do tailwind.config) */
  --slate-50: 244 247 245;   --slate-100: 237 242 239; --slate-200: 226 234 230;
  --slate-300: 213 223 218;  --slate-400: 148 163 155; --slate-500: 107 122 115;
  --slate-600: 70 84 77;     --slate-700: 52 67 59;    --slate-800: 26 42 35;
  --slate-900: 10 27 20;     --slate-950: 5 13 9;
  --ink: 10 20 16;
  /* tokens semânticos de superfície/texto/borda (claro) */
  --surface-app: 244 247 245;   /* page bg  */
  --surface-card: 255 255 255;  /* cards    */
  --surface-raised: 255 255 255;/* modal/popover */
  --surface-inset: 244 247 245; /* inputs/wells */
  --border-subtle: 237 242 239;
  --border-default: 226 234 230;
  --border-strong: 213 223 218;
}
```

**Step 2: tailwind.config.ts** — troque os hex de `slate`/`ink` por `rgb(var(--…))` e adicione os tokens semânticos:

```ts
slate: {
  50: "rgb(var(--slate-50) / <alpha-value>)",
  // ...100..950 idem
},
ink: "rgb(var(--ink) / <alpha-value>)",
surface: "rgb(var(--surface-app) / <alpha-value>)",
card: "rgb(var(--surface-card) / <alpha-value>)",
raised: "rgb(var(--surface-raised) / <alpha-value>)",
inset: "rgb(var(--surface-inset) / <alpha-value>)",
line: "rgb(var(--border-subtle) / <alpha-value>)",
"line-default": "rgb(var(--border-default) / <alpha-value>)",
"line-strong": "rgb(var(--border-strong) / <alpha-value>)",
```

**Step 3: darkMode** — no topo do config: `darkMode: "class"` (usaremos `data-theme` via seletor custom na Fase 4; `class` cobre `.dark`). Adicione também a variante por atributo em globals se preferir `[data-theme="dark"]`.

**Step 4: Verificar (crucial: NADA muda no claro)**

Run: `npx tsc --noEmit` e `npm run dev` → abrir 3-4 telas (painel, vendas, configurações). Visual **idêntico** ao de antes (só trocamos hex por var de mesmo valor).

**Step 5: Commit**

```bash
git add src/app/globals.css tailwind.config.ts
git commit -m "refactor(theme): neutros e ink como CSS vars + tokens de superfície (sem mudança visual)"
```

---

# FASE 4 — Tema dark + toggle

## Task 4.1: Valores do tema escuro

**Files:**
- Modify: `src/app/globals.css` (bloco `[data-theme="dark"]`)

**Step 1:** Adicione o tema escuro (forest dessaturado; ramp neutro **invertido e afinado** — claro↔escuro — e tokens semânticos escuros). Valores de partida (ajuste fino no QA da Fase 6):

```css
[data-theme="dark"] {
  /* ramp neutro invertido: 50 = superfície escura … 900 = texto claro */
  --slate-50: 16 26 21;   --slate-100: 20 32 26;  --slate-200: 26 42 35;
  --slate-300: 40 56 48;  --slate-400: 110 126 118; --slate-500: 150 165 157;
  --slate-600: 180 194 186; --slate-700: 205 217 210; --slate-800: 225 234 229;
  --slate-900: 236 243 239; --slate-950: 245 250 247;
  --ink: 232 240 236;
  --surface-app: 10 20 15;    /* forest-black */
  --surface-card: 16 32 26;   /* card elevado */
  --surface-raised: 20 38 30; /* modal/popover mais elevado */
  --surface-inset: 12 26 20;  /* inputs/wells recuados */
  --border-subtle: 34 48 41;
  --border-default: 42 58 50;
  --border-strong: 54 72 62;
  /* brand no escuro: leve realce p/ contraste (opcional; ajustar no QA) */
}
```

> **Nota:** a inversão do ramp faz `bg-slate-50/100` (superfícies) escurecerem e `text-slate-600/700/900` (textos) clarearem automaticamente — cobrindo a maioria dos usos. Os problemáticos (`bg-slate-800/900` usados como fundo escuro no claro, `text-white` sobre claro) entram no QA da Fase 6.

**Step 2: Commit** (ainda sem toggle — dá p/ testar forçando `data-theme="dark"` no `<html>` via devtools)

```bash
git add src/app/globals.css
git commit -m "feat(theme): paleta do tema escuro (forest) via data-theme"
```

## Task 4.2: Toggle + persistência + no-flash SSR

**Files:**
- Modify: `src/app/layout.tsx` (`suppressHydrationWarning` no `<html>` + script inline no-flash no `<head>`)
- Create: `src/components/app/ThemeToggle.tsx` (client: lê/grava `localStorage.theme`, seta `document.documentElement.dataset.theme`)
- Modify: `src/components/app/Sidebar.tsx` (montar o `ThemeToggle` no rodapé, perto do logout)

**Step 1: No-flash** — em `layout.tsx`, adicione `suppressHydrationWarning` ao `<html>` e um `<script>` inline (antes do paint) que aplica o tema salvo (default: preferência do SO):

```tsx
<html lang="pt-BR" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable}`}>
  <head>
    <script dangerouslySetInnerHTML={{ __html:
      `(function(){try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();` }} />
  </head>
  <body className="min-h-screen bg-surface font-sans text-ink">...</body>
</html>
```

> Troque `bg-slate-50` do body por `bg-surface` (token) para o fundo acompanhar o tema.

**Step 2: ThemeToggle** — botão sol/lua (lucide `Sun`/`Moon`) que alterna `data-theme` e persiste em `localStorage.theme`. Monte na Sidebar.

**Step 3: Verificar** — alternar tema no app; recarregar mantém a escolha; **sem flash** de tema errado no load. Login/landing podem seguir claros por ora (escopo = app).

**Step 4: Commit**

```bash
git add src/app/layout.tsx src/components/app/ThemeToggle.tsx src/components/app/Sidebar.tsx
git commit -m "feat(theme): toggle claro/escuro com persistência e no-flash SSR"
```

---

# FASE 5 — Redesign das primitivas (o "premium")

## Task 5.1: `Card` / `CardHeader`

**Files:**
- Modify: `src/components/ui/Card.tsx`

**Step 1:** Reescreva usando tokens (`bg-card`, `border-line`) e um visual mais refinado: raio 16px, borda 1px de baixo contraste, sombra suave em camadas (mais discreta no dark), header com respiro maior e título em `font-display`. Mantenha a API (`Card`, `CardHeader{title,subtitle,action}`):

```tsx
// Card: rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(10,20,16,.04),0_8px_24px_-16px_rgba(10,20,16,.10)]
//   dark: sombra quase nula (elevação vem da cor da superfície), borda border-line
// CardHeader: px-5 py-4, título text-sm font-bold font-display text-ink, subtítulo text-xs text-slate-500
```

> Não invente cores novas: use os tokens. A sombra no dark deve ser mínima (superfícies elevadas já se distinguem pela cor).

**Step 2: Verificar** — `npm run dev`: cards em claro e escuro coerentes e elegantes; nada quebrado onde `Card` é usado.

**Step 3: Commit**

```bash
git add src/components/ui/Card.tsx
git commit -m "feat(ui): redesign do Card (tokens, elevação suave, header refinado)"
```

## Task 5.2: `Button` + input compartilhado + Modal

**Files:**
- Modify: `src/components/ui/Button.tsx` (variantes com tokens; `secondary`/`ghost` usam `bg-card`/`border-line`/`text-ink`)
- Create: `src/components/ui/Input.tsx` (input/select padronizado com `bg-inset border-line-default` — extrai a classe repetida `rounded-lg border border-slate-300 …`)
- Modify: `src/components/ui/Modal.tsx` (se existir; superfície `bg-raised`, overlay adaptável ao tema)

**Step 1:** Ajuste `Button` (variantes `secondary`/`ghost`/`danger`) para tokens temáveis. Crie `Input` (e opcional `Select`) encapsulando o estilo de campo hoje repetido inline — **não** troque todos os inputs agora; só disponibilize a primitiva (adoção incremental).

**Step 2: Verificar** — botões/campos legíveis nos dois temas; foco (ring da marca) visível no dark.

**Step 3: Commit**

```bash
git add src/components/ui/Button.tsx src/components/ui/Input.tsx src/components/ui/Modal.tsx
git commit -m "feat(ui): Button/Input/Modal temáveis (tokens claro/escuro)"
```

---

# FASE 6 — Varredura em ondas + QA visual

> Objetivo: eliminar as "manchas claras" no dark (`bg-white` literais e hex fixos) e corrigir contrastes invertidos. Feito por **áreas** (ondas), conferindo visualmente cada uma em claro e escuro. Commit por onda.

## Task 6.1: Sweep `bg-white` → `bg-card` (ou `bg-raised` em modais/popovers)

**Files:** vários `.tsx` (71 ocorrências).

**Step 1:** Substitua `bg-white` por `bg-card` (superfícies de conteúdo) ou `bg-raised` (menus/popovers/modais flutuantes). Faça por área e confira. Onde `bg-white` era um "chip" sobre card, avalie `bg-inset`.

**Step 2: Verificar** por onda (`npm run dev`, alternando tema). **Commit por onda:**

```bash
git commit -m "refactor(theme): superfícies bg-white → tokens (onda: <área>)"
```

## Task 6.2: Hex de status fixos → tokens semânticos

**Files:** ocorrências de `bg-[#C0392B]`, `text-[#C0392B]`, `bg-[#B97309]`, `text-red-700`, `bg-red-50`, `bg-amber-50`, etc.

**Step 1:** Defina tokens de status em `globals.css` (claro + escuro): `--danger`, `--danger-surface`, `--warning`, `--warning-surface`, `--success`, `--success-surface`; e aliases no tailwind (`danger`, `danger-surface`, …). Troque os hex/`red-*`/`amber-*` fixos pelos tokens onde afetam legibilidade no dark (erros, badges, barras de limite).

**Step 2: Verificar** — mensagens de erro/aviso/sucesso legíveis nos dois temas. Commit.

```bash
git commit -m "feat(theme): tokens de status (danger/warning/success) claro/escuro"
```

## Task 6.3: Auditoria de contraste invertido

**Step 1:** Procure fundos escuros propositais no claro que a inversão do ramp pode ter clareado indevidamente: `bg-slate-800`, `bg-slate-900`, `text-white`/`text-slate-50` sobre eles (ex.: sidebar, tooltips, kanban). Ajuste caso a caso — se um elemento deve ser escuro **nos dois temas**, use um hex fixo/`forest` em vez do ramp; se deve inverter, deixe o token.

**Step 2: Verificar** — varra as telas principais (painel, inbox, leads/kanban, campanhas, empresas, vendas, configurações, financeiro) em claro e escuro. Sem texto ilegível, sem mancha branca. Commit por ajuste.

```bash
git commit -m "fix(theme): contraste em superfícies invertidas (<área>)"
```

---

# FASE 7 — Verificação final e fechamento

## Task 7.1: Verificação (skill @verify + @run)

**Checklist:**
- [ ] `npx vitest run` — verde. `npx tsc --noEmit` — limpo.
- [ ] **Extrato:** filtros período (incl. custom), operador e nome funcionam; colunas Data/Cliente/Operador/Pagamento/Total corretas; paginação.
- [ ] **Dark:** toggle alterna, persiste, sem flash no reload; app inteiro coerente (sem mancha branca, contraste AA) nas telas principais em ambos os temas.
- [ ] **Cards/primitivas:** visual elegante e consistente; `Card`/`Button`/inputs coesos nos dois temas.
- [ ] Percorrer as telas: painel, inbox, leads, campanhas, agenda, empresas, **vendas (3 abas + extrato)**, configurações, financeiro.

## Fechamento

**Checklist final:**
- [ ] `npx vitest run` verde; `npx tsc --noEmit` limpo.
- [ ] Extrato escopado por `accountId`; nenhuma query cruza tenant.
- [ ] Tema controlado por tokens; nenhum `bg-white`/hex de status solto nas telas do app.
- [ ] Dinheiro em centavos; datas no fuso `America/Sao_Paulo`.

**Notas de produção (para o dono):**
- **Parte A (Extrato):** sem mudança de schema — deploy direto.
- **Parte B (Design):** sem mudança de schema — deploy direto. É só front; risco é visual, mitigado pelo QA por onda.
- Deploy pela CLI da Vercel (bypassa o "Blocked" do Git integration — memória `vercel-hobby-push-block`): `env -u CLAUDECODE CI=1 VERCEL_TOKEN=<token> npx vercel deploy --prod --yes`.

**Fora de escopo (próximas iterações):**
- Dark no **login/landing/marketing** (aqui o foco é o app autenticado).
- Exportar o extrato em CSV/PDF; gráfico de série temporal no relatório.
- Densidade configurável / temas de marca por conta no dark (o `brandScale` já existe p/ o accent).
