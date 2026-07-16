# Caixa — Busca e filtro por data nas Despesas — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dar às Despesas o mesmo poder de garimpo que o Extrato de vendas já tem: uma **barra de filtro** (intervalo de datas `de…até` + **busca por descrição**) que estreita as listas **A pagar** e **Pagas**, com **paginação** nas Pagas ("carregar mais") — para o dono achar qualquer lançamento por data ou por nome.

**Architecture:** Espelha o padrão consolidado de vendas (`sales-history.service` + `orders/history` route + `SalesHistoryPanel`). As funções de listagem de despesa (`listPayable`/`listPaid`) ganham **filtros opcionais** (intervalo de datas + `query` em `description`, `mode: insensitive`). "A pagar" filtra por **`dueDate`** (vencimento); "Pagas" filtra por **`paidAt`** (regime de caixa, coerente com o relatório) e passa a devolver **página** `{ items, total }`. A rota GET de despesas ganha os params `from`/`to`/`q`/`paidSkip`/`paidTake`. A UI da `ExpensesPanel` ganha uma barra de filtro no topo que dirige as duas seções. Tudo continua **gated por `canSettings`** e escopado por `accountId`.

**Tech Stack:** Next.js (App Router, RSC + client) · Prisma + Postgres (`contains`/`mode: insensitive`) · Zod · TailwindCSS · Vitest (`*.test.ts` co-locado).

**Escopo (o que NÃO entra):** período custom nos cards do Resumo (o dono não pediu); busca no catálogo (é cadastro, não lançamento); filtro por categoria/status na barra (data + texto cobre o pedido — categoria pode vir depois); export CSV; filtro nas Despesas fixas (são um modelo, não um lançamento).

**Convenções (leia antes):**
- **Datas na borda:** a UI manda ISO já no fuso do projeto, igual ao Extrato de vendas: `new Date(\`${from}T00:00:00-03:00\`).toISOString()` e `…T23:59:59-03:00`. A API faz `new Date(raw)` e valida `isNaN`. Reaproveite esse exato padrão de [orders/history/route.ts](src/app/api/vendas/orders/history/route.ts).
- **Busca:** `description: { contains: q.trim(), mode: "insensitive" }` (padrão de `sales-history.service`).
- **Dinheiro** sempre em centavos; formata só na UI (`formatCentsBRL`).
- **Tenancy:** tudo por `accountId = ctx.tenantUserId`. **Permissão:** todas as rotas de despesa exigem `ctx.perms.canSettings` (403).
- **Testes de serviço** tocam o banco de dev e criam um dono descartável por teste (padrão de `expense.service.test.ts`).
- **Commits frequentes** ao fim de cada task.

---

## Visão geral das fases

- **Fase 1** — Serviço: filtros opcionais em `listPayable`; `listPaid` vira paginado+filtrado `{ items, total }` (TDD).
- **Fase 2** — API: GET de despesas parseia `from`/`to`/`q`/`paidSkip`/`paidTake` e devolve `{ payable, paid: { items, total } }`.
- **Fase 3** — UI: barra de filtro (datas + busca) na `ExpensesPanel`, dirigindo A pagar + Pagas, com "carregar mais" nas Pagas.
- **Fase 4** — Verificação (testes + tsc + build + E2E manual).

---

# FASE 1 — Serviço com filtros

## Task 1.1: `listPayable` com filtro de data (`dueDate`) + busca

**Files:**
- Modify: `src/server/services/expense.service.ts` (assinatura de `listPayable`)
- Test: `src/server/services/expense.service.test.ts` (novo bloco)

`listPayable` passa a aceitar um 2º argumento **opcional** `{ from?, to?, query? }`. Sem ele, comportamento idêntico ao de hoje (nenhum filtro). Com ele: `dueDate` no intervalo (quando `from`/`to` vierem) e `description` contendo `query` (case-insensitive).

**Step 1: Teste que falha** (anexar ao `expense.service.test.ts`):

```ts
describe("expense.service — filtro de A pagar", () => {
  it("filtra pendentes por intervalo de vencimento e por descrição", async () => {
    const a = await makeOwner();
    await createExpense(a, { description: "Aluguel sala", amountCents: 1000, dueDate: "2026-07-05", createdById: a });
    await createExpense(a, { description: "Luz", amountCents: 2000, dueDate: "2026-07-20", createdById: a });
    await createExpense(a, { description: "Internet", amountCents: 3000, dueDate: "2026-08-10", createdById: a });

    // por data (só julho)
    const jul = await listPayable(a, {
      from: new Date("2026-07-01T00:00:00-03:00"),
      to: new Date("2026-07-31T23:59:59-03:00"),
    });
    expect(jul.map((e) => e.description).sort()).toEqual(["Aluguel sala", "Luz"]);

    // por texto (case-insensitive)
    const alug = await listPayable(a, { query: "aluguel" });
    expect(alug).toHaveLength(1);
    expect(alug[0].description).toBe("Aluguel sala");

    // sem filtro = tudo
    expect(await listPayable(a)).toHaveLength(3);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/expense.service.test.ts`
Expected: FAIL — `listPayable` ainda não aceita filtros (o teste de data/텍스trará resultados errados ou erro de tipo).

**Step 3: Implementar** — substitua a função `listPayable` por:

```ts
export async function listPayable(
  accountId: string,
  opts: { from?: Date; to?: Date; query?: string } = {},
): Promise<ExpenseDTO[]> {
  const q = opts.query?.trim();
  const rows = await prisma.expense.findMany({
    where: {
      accountId,
      status: "PENDENTE",
      ...(opts.from || opts.to
        ? { dueDate: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
      ...(q ? { description: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: { dueDate: "asc" },
  });
  return rows.map(toDTO);
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/expense.service.test.ts`
Expected: PASS (todos, inclusive os antigos — a chamada sem args segue igual).

**Step 5: Commit**

```bash
git add src/server/services/expense.service.ts src/server/services/expense.service.test.ts
git commit -m "feat(caixa): filtro por vencimento e busca por descrição em A pagar"
```

---

## Task 1.2: `listPaid` paginado + filtrado (`paidAt`) → `{ items, total }`

**Files:**
- Modify: `src/server/services/expense.service.ts` (assinatura + retorno de `listPaid`)
- Modify: `src/server/services/expense.service.test.ts` (ajustar teste existente + novo)

`listPaid` passa a aceitar `{ from?, to?, query?, skip?, take? }` e a devolver **`{ items, total }`** (para o "carregar mais"). Filtra por `paidAt` no intervalo (regime de caixa) e `description`. Ordena por `paidAt desc`. `take` default 50, teto 100.

> **Atenção — quebra de retorno:** o teste antigo `"nasce já paga…"` faz `(await listPaid(a)).map(...)`. Ajuste para `(await listPaid(a)).items.map(...)`. É a única chamada de teste afetada.

**Step 1: Ajustar o teste antigo** — em `expense.service.test.ts`, no teste `"nasce já paga quando paidNow=true"`, troque:

```ts
    expect((await listPaid(a)).map((x) => x.id)).toContain(e.id);
```
por:
```ts
    expect((await listPaid(a)).items.map((x) => x.id)).toContain(e.id);
```

**Step 2: Teste novo que falha** (anexar):

```ts
describe("expense.service — extrato de Pagas", () => {
  it("filtra pagas por período (paidAt) e descrição, com total e paginação", async () => {
    const a = await makeOwner();
    // 3 pagas + 1 pendente
    for (const [desc, val] of [["Fornecedor A", 1000], ["Fornecedor B", 2000], ["Aluguel", 3000]] as const) {
      const e = await createExpense(a, { description: desc, amountCents: val, dueDate: "2026-07-05", createdById: a });
      await payExpense(a, e.id);
    }
    await createExpense(a, { description: "Pendente", amountCents: 9, dueDate: "2026-07-05", createdById: a });

    const all = await listPaid(a);
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(3);

    // busca por texto
    const forn = await listPaid(a, { query: "fornecedor" });
    expect(forn.total).toBe(2);

    // paginação: take=2 → 2 itens mas total=3
    const page1 = await listPaid(a, { take: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);

    // período que não pega nada (mês passado)
    const empty = await listPaid(a, {
      from: new Date("2026-06-01T00:00:00-03:00"),
      to: new Date("2026-06-30T23:59:59-03:00"),
    });
    expect(empty.total).toBe(0);
  });
});
```

**Step 3: Rodar e ver falhar**

Run: `npx vitest run src/server/services/expense.service.test.ts`
Expected: FAIL — `listPaid` ainda retorna array (sem `.total`/`.items`).

**Step 4: Implementar** — substitua a função `listPaid` por:

```ts
export interface ExpensePage { items: ExpenseDTO[]; total: number; }

export async function listPaid(
  accountId: string,
  opts: { from?: Date; to?: Date; query?: string; skip?: number; take?: number } = {},
): Promise<ExpensePage> {
  const q = opts.query?.trim();
  const where = {
    accountId,
    status: "PAGA" as const,
    ...(opts.from || opts.to
      ? { paidAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
      : {}),
    ...(q ? { description: { contains: q, mode: "insensitive" as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { paidAt: "desc" },
      skip: opts.skip ?? 0,
      take: Math.min(opts.take ?? 50, 100),
    }),
    prisma.expense.count({ where }),
  ]);
  return { items: rows.map(toDTO), total };
}
```

**Step 5: Rodar e ver passar**

Run: `npx vitest run src/server/services/expense.service.test.ts`
Expected: PASS (todos).

**Step 6: Commit**

```bash
git add src/server/services/expense.service.ts src/server/services/expense.service.test.ts
git commit -m "feat(caixa): extrato de Pagas paginado + filtro por paidAt/descrição"
```

---

# FASE 2 — API

## Task 2.1: GET de despesas aceita `from`/`to`/`q` + paginação das Pagas

**Files:**
- Modify: `src/app/api/vendas/expenses/route.ts` (só o `GET`; `POST` fica igual)

Parseia `from`/`to` (ISO; valida `isNaN`), `q`, `paidSkip`, `paidTake`. Aplica o intervalo/busca nas duas listas. **Continua** gerando as fixas do mês antes de listar (idempotente). Resposta nova: `{ payable, paid: { items, total } }`.

**Step 1: Substituir o `GET`** por:

```ts
export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");
  let from: Date | undefined;
  let to: Date | undefined;
  if (fromRaw) { from = new Date(fromRaw); if (isNaN(+from)) return NextResponse.json({ error: "Data inicial inválida" }, { status: 400 }); }
  if (toRaw) { to = new Date(toRaw); if (isNaN(+to)) return NextResponse.json({ error: "Data final inválida" }, { status: 400 }); }
  const q = sp.get("q") || undefined;
  const paidSkip = Number(sp.get("paidSkip") ?? 0) || 0;
  const paidTake = Math.min(Number(sp.get("paidTake") ?? 50) || 50, 100);

  // Garante as fixas do mês corrente antes de listar (lazy, idempotente).
  await ensureRecurringForMonth(ctx.tenantUserId, competenceMonth());
  const [payable, paid] = await Promise.all([
    listPayable(ctx.tenantUserId, { from, to, query: q }),
    listPaid(ctx.tenantUserId, { from, to, query: q, skip: paidSkip, take: paidTake }),
  ]);
  return NextResponse.json({ payable, paid });
}
```

> `GET` agora usa `req` — troque a assinatura `export async function GET()` por `export async function GET(req: NextRequest)`. `NextRequest` já está importado no arquivo.

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add src/app/api/vendas/expenses/route.ts
git commit -m "feat(caixa): API de despesas aceita filtro por data, busca e paginação das pagas"
```

---

# FASE 3 — UI

## Task 3.1: Barra de filtro (datas + busca) na `ExpensesPanel` + "carregar mais"

**Files:**
- Modify: `src/components/vendas/ExpensesPanel.tsx`

Adiciona no topo uma **barra de filtro** com dois `<input type="date">` (`de…até`) e um `<input type="search">` (busca por descrição, com **debounce 300ms**). O filtro dirige as duas seções. **Pagas** vira paginada (`{ items, total }`) com botão **"Carregar mais"**. Guarda a requisição mais recente com um `reqRef` para evitar corrida (padrão de `SalesHistoryPanel`). Segue usando `formatCentsBRL`, `Card`/`Button` e mostra `d.error` em erro.

**Step 1: Trocar o estado e o `load`** — no componente `ExpensesPanel`:

- Troque `const [paid, setPaid] = useState<Expense[]>([]);` por:
  ```ts
  const [paid, setPaid] = useState<Expense[]>([]);
  const [paidTotal, setPaidTotal] = useState(0);
  ```
- Adicione o estado do filtro (perto dos outros `useState`):
  ```ts
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const reqRef = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  ```
  (adicione `useRef` ao import do React.)
- Um helper para montar a query (datas no fuso do projeto, igual ao Extrato de vendas):
  ```ts
  const buildQuery = useCallback((paidSkip: number) => {
    const sp = new URLSearchParams();
    if (from) sp.set("from", new Date(`${from}T00:00:00-03:00`).toISOString());
    if (to) sp.set("to", new Date(`${to}T23:59:59-03:00`).toISOString());
    if (qDebounced.trim()) sp.set("q", qDebounced.trim());
    sp.set("paidSkip", String(paidSkip));
    sp.set("paidTake", "50");
    return sp.toString();
  }, [from, to, qDebounced]);
  ```
- Reescreva `load` para aceitar `(paidSkip, appendPaid)` e tratar a resposta nova `{ payable, paid: { items, total } }`, protegendo contra corrida e mantendo a busca das fixas no servidor (o GET já as gera). As recorrentes (`/api/vendas/expenses/recurring`) só precisam ser buscadas na carga inicial:

  ```ts
  const load = useCallback(async (paidSkip = 0, appendPaid = false) => {
    const reqId = ++reqRef.current;
    try {
      const exp = await fetch(`/api/vendas/expenses?${buildQuery(paidSkip)}`, { cache: "no-store" }).then((r) => r.json());
      if (reqId !== reqRef.current) return; // resposta obsoleta
      setPayable((exp.payable as Expense[]) ?? []);
      setPaid((prev) => (appendPaid ? [...prev, ...(exp.paid?.items ?? [])] : (exp.paid?.items ?? [])));
      setPaidTotal(exp.paid?.total ?? 0);
    } catch {
      /* mantém estado anterior */
    }
  }, [buildQuery]);

  const loadRecurring = useCallback(async () => {
    try {
      const rec = await fetch("/api/vendas/expenses/recurring", { cache: "no-store" }).then((r) => r.json());
      setRecurring((rec.recurring as Recurring[]) ?? []);
    } catch { /* mantém */ }
  }, []);

  useEffect(() => { load(0, false); }, [load]);        // recarrega ao mudar filtro
  useEffect(() => { loadRecurring(); }, [loadRecurring]);
  ```

  > Ajuste as chamadas existentes de ações (pagar/excluir/criar/recorrentes) que faziam `.then(load)` / `await load()` para `load()` (sem args → recarrega a 1ª página com o filtro atual) e, quando mexerem em recorrentes, também `loadRecurring()`. Ex.: no `PayButton`/`DeleteButton`/`NewExpenseForm` use `onDone={() => load()}`; no `RecurringManager` use `onChange={() => { load(); loadRecurring(); }}` (uma fixa nova/removida muda o que é gerado).

**Step 2: Barra de filtro no JSX** — logo abaixo do `<div className="space-y-4">` inicial, antes do Card "A pagar":

```tsx
{/* Filtro: intervalo de datas + busca por descrição */}
<div className="flex flex-wrap items-center gap-3">
  <div className="flex items-center gap-2">
    <input
      type="date"
      value={from}
      onChange={(e) => setFrom(e.target.value)}
      className="rounded-lg border border-line-default bg-inset px-3 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
    />
    <span className="text-sm text-slate-400">até</span>
    <input
      type="date"
      value={to}
      onChange={(e) => setTo(e.target.value)}
      className="rounded-lg border border-line-default bg-inset px-3 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
    />
  </div>
  <input
    type="search"
    value={q}
    onChange={(e) => setQ(e.target.value)}
    placeholder="Buscar despesa…"
    className="min-w-[180px] flex-1 rounded-lg border border-line-default bg-inset px-3 py-1.5 text-sm text-ink placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
  />
  {(from || to || q) && (
    <button
      type="button"
      onClick={() => { setFrom(""); setTo(""); setQ(""); }}
      className="text-sm text-slate-500 hover:text-ink"
    >
      Limpar
    </button>
  )}
</div>
```

> A barra dirige as duas seções: "A pagar" filtra por **vencimento**; "Pagas" por **data de pagamento** — ambos no mesmo intervalo. A busca casa a **descrição** nos dois. (Comportamento vindo do servidor; nada muda no cálculo local.)

**Step 3: "Carregar mais" nas Pagas** — dentro do bloco recolhível de "Pagas", após a `<ul>` da lista, quando houver mais:

```tsx
{paid.length < paidTotal && (
  <div className="pt-3">
    <button
      type="button"
      onClick={() => load(paid.length, true)}
      className="inline-flex items-center gap-2 rounded-lg border border-line-default bg-card px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
    >
      Carregar mais
    </button>
  </div>
)}
```

E troque o rótulo do cabeçalho recolhível de `Pagas ({paid.length})` para `Pagas ({paidTotal})` — o total real, não só as carregadas.

**Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. (Render real na verificação.)

**Step 5: Commit**

```bash
git add src/components/vendas/ExpensesPanel.tsx
git commit -m "feat(caixa): barra de filtro (data + busca) e paginação das pagas na aba Despesas"
```

---

# FASE 4 — Verificação

## Task 4.1: Verificação end-to-end

Use a skill @verify. Run: `npm run dev` (aba Caixa → Despesas).

**Checklist:**
- [ ] Sem filtro: A pagar e Pagas aparecem como hoje; "Pagas ({total})" bate com a quantidade real.
- [ ] **Busca** "aluguel" → A pagar e Pagas mostram só o que casa a descrição (case-insensitive); limpar volta tudo.
- [ ] **Intervalo de datas** (ex.: só este mês) → A pagar filtra por vencimento; Pagas filtra por data de pagamento.
- [ ] **Carregar mais** aparece quando `total > carregadas` e anexa a próxima página (sem duplicar).
- [ ] Marcar paga / excluir / nova despesa / nova fixa → a lista recarrega respeitando o filtro atual.
- [ ] **Corrida:** digitar rápido na busca não deixa resultado obsoleto grudado (reqRef).
- [ ] **Permissão:** operador sem `canSettings` segue sem a aba; `GET /api/vendas/expenses?q=x` direto retorna 403.
- [ ] `npx vitest run` (verde) e `npx tsc --noEmit` (limpo) e `npm run build` (ok).

---

## Fechamento

**Checklist final:**
- [ ] `npx vitest run` — verde.
- [ ] `npx tsc --noEmit` — limpo.
- [ ] `npm run build` — ok.
- [ ] Filtro/busca 100% no servidor, escopado por `accountId`, gated por `canSettings`.
- [ ] Dinheiro em centavos; datas no fuso do projeto na borda da UI.

**Notas de produção:**
- **Sem mudança de schema** → **não precisa** de SQL manual nem migração. Só código.
- Deploy pela CLI da Vercel (bloqueio de push do Hobby), como no Caixa.
- Índices já existentes cobrem os filtros: `Expense_accountId_status_dueDate_idx` (A pagar por vencimento) e `Expense_accountId_paidAt_idx` (Pagas por pagamento). A busca por `description` é `contains` sem índice — ok no volume de um negócio pequeno; se crescer, considerar `pg_trgm`.

**Fora de escopo (v2):** filtro por categoria/status na barra; export CSV/planilha; período custom nos cards do Resumo; busca global unificada (comandas + despesas na mesma tela).
