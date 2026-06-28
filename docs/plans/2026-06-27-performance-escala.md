# Plano de Performance & Escala do CRM

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deixar a infraestrutura e a arquitetura limpas e rápidas em escala (100+ contas, 10k+ leads/conta), eliminando os gargalos de "carrega tudo, o tempo todo, em loop".

**Architecture:** Seis fases independentes em ordem de impacto/risco. Fase 0 são correções pontuais de baixo risco. Fase 1 (paginação) é a mudança estrutural central — backend + frontend, porque hoje o filtro/busca acontece no cliente sobre a lista inteira. Fase 2 (cache Redis) tira carga repetida do Postgres. Fase 3 torna o disparo de campanha assíncrono e idempotente. Fase 4 corrige render do frontend. Fase 5 troca polling por push. Fase 6 é endurecimento (rate limit, observabilidade, migrations).

**Tech Stack:** Next.js 15 (App Router) + React 19, Prisma 6 (PostgreSQL via pgbouncer), Vitest, worker em `tsx`, Baileys, Redis (a introduzir), `pino` (já instalado, não usado).

**Convenções do repo (respeitar):**
- Testes: Vitest (`npm test` → `vitest run`). Testes de service mockam `@/server/db/client` com `vi.mock` (ver `src/lib/tenant.test.ts`). Co-localizados como `*.test.ts` ao lado do arquivo.
- Escopo de dados sempre por `tenantUserId` (dono = `ownerId ?? id`), resolvido por `getTenantContext()` / `getTenantUserId()` em `src/lib/tenant.ts`.
- Comentários em PT-BR, explicando o *porquê* (seguir o estilo existente).
- Commits pequenos e frequentes, em PT-BR, prefixo convencional (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`).

**Pré-requisito de ambiente (executar antes da Fase 2):** provisionar um Redis (Railway plugin ou Upstash) e expor `REDIS_URL` nas envs do **web** e do **worker**.

---

## Fase 0 — Correções pontuais de baixo risco

Itens independentes, cada um isolado e reversível. Fazer primeiro: dão retorno imediato e não mexem em contratos de API.

### Task 0.1: `connection_limit` no Postgres (pool por processo)

**Contexto:** `new PrismaClient()` em `src/server/db/client.ts` não configura pool. Web + worker são 2 processos; sob disparo concorrente o pool default esgota e queries viram timeout → jobs `FAILED` indevidos. O Prisma **não** aceita `connectionLimit` no construtor — configura-se na connection string.

**Files:**
- Modify: `.env.example` (documentar)
- Modify: `src/server/db/client.ts:13-17` (comentário explicativo; sem mudança de código se o limite vier da URL)

**Step 1: Documentar a env**

Em `.env.example`, na linha do `DATABASE_URL`, adicionar comentário e o parâmetro:

```bash
# Pool por PROCESSO. Web + worker = 2 processos; manter baixo p/ não estourar o
# limite do Postgres/pgbouncer. Some os processos: 5+5 = 10 conexões.
# Ex.: postgresql://user:pass@host:6543/db?pgbouncer=true&connection_limit=5&pool_timeout=20
DATABASE_URL=
```

**Step 2: Comentar a intenção no client**

Em `src/server/db/client.ts`, acima do `new PrismaClient`, adicionar comentário:

```typescript
// Pool: configurado via `?connection_limit=N&pool_timeout=N` na DATABASE_URL
// (NÃO existe opção de pool no construtor do Prisma). Ver .env.example.
```

**Step 3: Aplicar no Railway**

Atualizar `DATABASE_URL` no serviço **web** e no **worker** (Railway → Variables) acrescentando `&connection_limit=5&pool_timeout=20`. Validar que o app sobe (`npx prisma generate` no build não muda).

**Step 4: Commit**

```bash
git add .env.example src/server/db/client.ts
git commit -m "perf(db): documentar e aplicar connection_limit por processo"
```

> Sem teste automatizado — é configuração de runtime. Validar manualmente: subir o app, abrir /leads, confirmar que conecta.

---

### Task 0.2: Fechar fallback global de tenant em `resolveLead`

**Contexto:** `src/server/services/conversation.service.ts:59-61` tem um fallback `findFirst({ where: { phone } })` **sem filtro de conta**. Os caminhos normais (linhas 45-57) estão corretos; este ramo só dispara quando não há `whatsAppNumberId` **nem** `userId`. Se atingido, casa o lead de qualquer conta → vazamento entre tenants. Deve retornar `null`.

**Files:**
- Modify: `src/server/services/conversation.service.ts:59-61`
- Test: `src/server/services/conversation.service.test.ts` (criar se não existir)

**Step 1: Escrever o teste que falha**

Verificar primeiro se já existe `conversation.service.test.ts`. Se não, criar com o mock padrão:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: { lead: { findFirst: vi.fn() } },
}));

describe("resolveLead — isolamento de tenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem whatsAppNumberId e sem userId, NÃO busca global por telefone (retorna null)", async () => {
    const { prisma } = await import("@/server/db/client");
    const { resolveLead } = await import("./conversation.service");
    const result = await resolveLead({ phone: "+5511999999999" });
    expect(result).toBeNull();
    // Não pode ter consultado o banco com filtro só de telefone.
    expect((prisma.lead.findFirst as any)).not.toHaveBeenCalled();
  });
});
```

> Confirmar que `resolveLead` é exportado. Se for interno, exportá-lo (ou testar via a função pública que o chama). Ajustar o nome conforme o código real.

**Step 2: Rodar e ver falhar**

Run: `npm test -- conversation.service`
Expected: FAIL (hoje ele chama `findFirst` e retorna um lead).

**Step 3: Implementar**

Substituir o bloco em `conversation.service.ts:59-61`:

```typescript
  if (input.phone) {
    // Sem whatsAppNumberId nem userId não há como escopar a conta: buscar global
    // casaria o lead de QUALQUER tenant (vazamento). Melhor não resolver.
    return null;
  }
```

**Step 4: Rodar e ver passar**

Run: `npm test -- conversation.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/services/conversation.service.ts src/server/services/conversation.service.test.ts
git commit -m "fix(tenant): não resolver lead por telefone sem escopo de conta"
```

---

### Task 0.3: Trocar `count()` por `findFirst` em checagens de existência

**Contexto:** `conversation.service.ts` usa `prisma.message.count({ where: { leadId, direction: "OUTBOUND" } }) > 0` em cada inbound. `count` percorre todas as linhas; só precisamos saber se existe ≥1.

**Files:**
- Modify: `src/server/services/conversation.service.ts` (linha do `hasOutbound`, ~206)

**Step 1: Implementar**

```typescript
  // Existe pelo menos 1 OUTBOUND? findFirst para na 1ª linha (count varre tudo).
  const firstOutbound = await prisma.message.findFirst({
    where: { leadId: lead.id, direction: "OUTBOUND" },
    select: { id: true },
  });
  const hasOutbound = !!firstOutbound;
```

**Step 2: Rodar a suíte**

Run: `npm test`
Expected: PASS (sem regressões; comportamento idêntico).

**Step 3: Commit**

```bash
git add src/server/services/conversation.service.ts
git commit -m "perf(conversation): existência de OUTBOUND via findFirst em vez de count"
```

---

### Task 0.4: Paralelizar validações em `setLeadTags`

**Contexto:** `src/server/services/tag.service.ts` faz a checagem do lead e das tags em série; são independentes.

**Files:**
- Modify: `src/server/services/tag.service.ts` (`setLeadTags`, ~102-119)
- Test: `src/server/services/tag.service.test.ts` (criar se não existir)

**Step 1: Teste que garante comportamento (lead inexistente lança)**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { findFirst: vi.fn(), update: vi.fn() },
    tag: { findMany: vi.fn() },
  },
}));

describe("setLeadTags", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lança quando o lead não pertence à conta", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.findFirst as any).mockResolvedValue(null);
    (prisma.tag.findMany as any).mockResolvedValue([]);
    const { setLeadTags } = await import("./tag.service");
    await expect(setLeadTags("user-1", "lead-x", ["t1"])).rejects.toThrow();
  });
});
```

**Step 2: Rodar e ver passar/ajustar**

Run: `npm test -- tag.service`
(Pode já passar — é teste de proteção antes do refactor.)

**Step 3: Refatorar para `Promise.all`**

```typescript
export async function setLeadTags(userId: string, leadId: string, tagIds: string[]): Promise<void> {
  const ids = [...new Set(tagIds)];
  // Lead e tags são checagens independentes → paralelizar.
  const [lead, owned] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, userId }, select: { id: true } }),
    ids.length > 0
      ? prisma.tag.findMany({ where: { id: { in: ids }, userId }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ]);
  if (!lead) throw new Error("Lead não encontrado.");
  if (ids.length > 0 && owned.length !== ids.length) {
    throw new Error("Uma ou mais tags não pertencem à sua conta.");
  }
  await prisma.lead.update({
    where: { id: leadId },
    data: { tags: { set: ids.map((id) => ({ id })) } },
  });
}
```

> Conferir o `data` do `update` contra o código atual e manter idêntico.

**Step 4: Rodar e ver passar**

Run: `npm test -- tag.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/services/tag.service.ts src/server/services/tag.service.test.ts
git commit -m "perf(tags): paralelizar validação de lead e tags em setLeadTags"
```

---

## Fase 1 — Paginação + filtros no servidor (mudança estrutural central)

**Decisão de arquitetura:** Hoje `/api/leads` retorna **todos** os leads e `LeadsDashboard` faz busca, filtros, contagem de campanhas/tags e stats **no cliente** sobre a lista inteira. Paginar só o backend quebraria filtros. Portanto esta fase move filtro/busca/paginação para o servidor e o frontend passa a consumir páginas + um endpoint separado de facetas (campanhas/tags/stats).

Ordem: 1.1 contrato do service → 1.2 endpoint → 1.3 facetas → 1.4 frontend → 1.5 demais listagens.

### Task 1.1: `listLeads` paginado e filtrável no service

**Files:**
- Modify: `src/server/services/lead.service.ts:33-65`
- Test: `src/server/services/lead.service.test.ts` (criar/!estender)

**Step 1: Definir o novo contrato (tipos)**

No topo do arquivo (ou junto dos tipos existentes):

```typescript
export interface ListLeadsParams {
  assignedToId?: string;
  skip?: number;            // default 0
  take?: number;            // default 50, cap 100
  query?: string;          // busca em name/phone
  status?: LeadStatus;
  campaignId?: string | null; // null = sem campanha
  optOut?: boolean;
  tagId?: string;
}
export interface ListLeadsResult {
  items: LeadListItem[];
  total: number;
}
```

**Step 2: Teste — cap de `take` em 100 e shape `{items,total}`**

```typescript
it("limita take a 100 e retorna { items, total }", async () => {
  const { prisma } = await import("@/server/db/client");
  (prisma.lead.findMany as any).mockResolvedValue([]);
  (prisma.lead.count as any).mockResolvedValue(0);
  const { listLeads } = await import("./lead.service");
  const res = await listLeads("user-1", { take: 999 });
  expect(res).toEqual({ items: [], total: 0 });
  const arg = (prisma.lead.findMany as any).mock.calls[0][0];
  expect(arg.take).toBe(100);
});
```

(mock inclui `lead.findMany`, `lead.count`.)

**Step 3: Rodar e ver falhar**

Run: `npm test -- lead.service`
Expected: FAIL

**Step 4: Implementar**

```typescript
export async function listLeads(
  userId: string,
  params: ListLeadsParams = {},
): Promise<ListLeadsResult> {
  const take = Math.min(params.take ?? 50, 100);
  const skip = params.skip ?? 0;
  const where = {
    userId,
    ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.campaignId === null
      ? { campaignId: null }
      : params.campaignId
        ? { campaignId: params.campaignId }
        : {}),
    ...(params.optOut !== undefined ? { optOut: params.optOut } : {}),
    ...(params.tagId ? { tags: { some: { id: params.tagId } } } : {}),
    ...(params.query
      ? {
          OR: [
            { name: { contains: params.query, mode: "insensitive" as const } },
            { phone: { contains: params.query } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      include: {
        campaign: { select: { name: true } },
        tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);
  return {
    items: rows.map((l) => ({
      id: l.id, name: l.name, phone: l.phone, email: l.email, status: l.status,
      score: l.score, optOut: l.optOut, campaignName: l.campaign?.name ?? null,
      lastMessage: l.messages[0]?.content ?? null, lastMessageAt: l.messages[0]?.createdAt ?? null,
      tags: l.tags, updatedAt: l.updatedAt,
    })),
    total,
  };
}
```

**Step 5: Rodar e ver passar**

Run: `npm test -- lead.service`
Expected: PASS

**Step 6: Adicionar índices de suporte**

Em `prisma/schema.prisma`, model `Lead`, adicionar índice para o ordenamento paginado por conta:

```prisma
  @@index([userId, updatedAt])
```

Depois: `npx prisma db push` (local). Anotar para aplicar em produção (ver memória `crm-inbox-db-push-pending`).

**Step 7: Commit**

```bash
git add src/server/services/lead.service.ts src/server/services/lead.service.test.ts prisma/schema.prisma
git commit -m "feat(leads): listLeads paginado e filtrável no servidor + índice"
```

---

### Task 1.2: Atualizar `GET /api/leads` para paginação/filtros

**Files:**
- Modify: `src/app/api/leads/route.ts:8-16`

**Step 1: Implementar leitura de query params**

```typescript
export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const assignedToId = ctx.perms.leadsScope === "ASSIGNED" ? ctx.sessionUserId : undefined;
  const result = await listLeads(ctx.tenantUserId, {
    assignedToId,
    skip: Number(sp.get("skip") ?? 0) || 0,
    take: Number(sp.get("take") ?? 50) || 50,
    query: sp.get("q") ?? undefined,
    status: (sp.get("status") as any) || undefined,
    campaignId: sp.get("campaignId") === "none" ? null : sp.get("campaignId") || undefined,
    optOut: sp.get("optOut") === null ? undefined : sp.get("optOut") === "true",
    tagId: sp.get("tagId") ?? undefined,
  });
  return NextResponse.json(result); // { items, total }
}
```

> A assinatura de `GET` muda de `()` para `(req: NextRequest)`. Conferir o import de `NextRequest` (já presente).

**Step 2: Rodar build/lint**

Run: `npm run lint`
Expected: sem erros novos.

**Step 3: Commit**

```bash
git add src/app/api/leads/route.ts
git commit -m "feat(api): GET /api/leads aceita paginação e filtros"
```

---

### Task 1.3: Endpoint de facetas (campanhas, tags, stats) do funil

**Contexto:** Os seletores de campanha/tag e os cards de stats hoje derivam da lista completa. Com paginação eles precisam de fonte própria — barata (agregações no banco).

**Files:**
- Create: `src/server/services/lead-facets.service.ts`
- Create: `src/app/api/leads/facets/route.ts`
- Test: `src/server/services/lead-facets.service.test.ts`

**Step 1: Teste do service**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/server/db/client", () => ({
  prisma: { lead: { groupBy: vi.fn() }, tag: { findMany: vi.fn() }, campaign: { findMany: vi.fn() } },
}));
describe("getLeadFacets", () => {
  beforeEach(() => vi.clearAllMocks());
  it("retorna contagem por status + listas de campanhas e tags", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.lead.groupBy as any).mockResolvedValue([{ status: "NOVO", _count: { _all: 3 } }]);
    (prisma.campaign.findMany as any).mockResolvedValue([{ id: "c1", name: "C1" }]);
    (prisma.tag.findMany as any).mockResolvedValue([{ id: "t1", name: "T1" }]);
    const { getLeadFacets } = await import("./lead-facets.service");
    const f = await getLeadFacets("user-1");
    expect(f.byStatus.NOVO).toBe(3);
    expect(f.campaigns).toHaveLength(1);
    expect(f.tags).toHaveLength(1);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npm test -- lead-facets`
Expected: FAIL

**Step 3: Implementar o service**

```typescript
import { prisma } from "@/server/db/client";

export interface LeadFacets {
  byStatus: Record<string, number>;
  campaigns: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  total: number;
}

export async function getLeadFacets(userId: string, assignedToId?: string): Promise<LeadFacets> {
  const where = { userId, ...(assignedToId ? { assignedToId } : {}) };
  const [grouped, campaigns, tags] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.campaign.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) { byStatus[g.status] = g._count._all; total += g._count._all; }
  return { byStatus, campaigns, tags, total };
}
```

**Step 4: Rodar e ver passar**

Run: `npm test -- lead-facets`
Expected: PASS

**Step 5: Criar a rota**

`src/app/api/leads/facets/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { getLeadFacets } from "@/server/services/lead-facets.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const assignedToId = ctx.perms.leadsScope === "ASSIGNED" ? ctx.sessionUserId : undefined;
  return NextResponse.json(await getLeadFacets(ctx.tenantUserId, assignedToId));
}
```

**Step 6: Commit**

```bash
git add src/server/services/lead-facets.service.ts src/server/services/lead-facets.service.test.ts src/app/api/leads/facets/route.ts
git commit -m "feat(leads): endpoint de facetas (status/campanhas/tags) para o dashboard"
```

---

### Task 1.4: `LeadsDashboard` consumindo páginas + facetas

**Contexto:** Reescrever a busca de dados: filtros viram query params (com **debounce** na busca textual), lista vira paginada (scroll infinito ou "carregar mais"), facetas vêm do endpoint novo. Remover os `useMemo` que derivavam campanhas/tags/stats da lista inteira.

**Files:**
- Modify: `src/components/LeadsDashboard.tsx`

**Step 1: Trocar a carga de leads por fetch parametrizado + paginado**

Substituir o `load` e os memos de facetas. Esboço:

```typescript
const [items, setItems] = useState<LeadListItem[]>([]);
const [total, setTotal] = useState(0);
const [skip, setSkip] = useState(0);
const TAKE = 50;
const [facets, setFacets] = useState<LeadFacets | null>(null);
const debouncedQuery = useDebounced(query, 350); // criar hook util useDebounced

const buildParams = useCallback(() => {
  const p = new URLSearchParams();
  p.set("skip", String(skip)); p.set("take", String(TAKE));
  if (debouncedQuery) p.set("q", debouncedQuery);
  if (statusFilter !== "ALL") p.set("status", statusFilter);
  if (campaignFilter === NO_CAMPAIGN) p.set("campaignId", "none");
  else if (campaignFilter !== "ALL") p.set("campaignId", campaignFilter);
  if (optOutFilter !== "ALL") p.set("optOut", String(optOutFilter === "optout"));
  if (tagFilter !== "ALL") p.set("tagId", tagFilter);
  return p.toString();
}, [skip, debouncedQuery, statusFilter, campaignFilter, optOutFilter, tagFilter]);

const load = useCallback(async () => {
  const res = await fetch(`/api/leads?${buildParams()}`, { cache: "no-store" });
  const data = await res.json();
  setItems(skip === 0 ? data.items : (prev) => [...prev, ...data.items]); // append em "carregar mais"
  setTotal(data.total);
}, [buildParams, skip]);
```

> Ao mudar **qualquer filtro**, resetar `skip` para 0. Carregar facetas em `useEffect` separado (uma vez, e após criar/editar/excluir lead).

**Step 2: Criar o hook `useDebounced`**

`src/lib/use-debounced.ts`:

```typescript
import { useEffect, useState } from "react";
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
```

**Step 3: Substituir os campanhas/tags/stats derivados pelos de `facets`**

Remover `campaignNames`, `tagOptions`, `stats` (derivados da lista) e ler de `facets`. O `filtered` client-side some — filtro agora é server-side.

**Step 4: UI de paginação**

Botão "Carregar mais" (`disabled={items.length >= total}`) que faz `setSkip(s => s + TAKE)`. Mostrar `items.length / total`.

**Step 5: Reduzir o polling**

Subir o `setInterval` de 4s para 15s e só revalidar a 1ª página (`skip === 0`). (Será substituído de vez na Fase 5.)

**Step 6: Validar manualmente**

Run: `npm run dev` → abrir /leads → testar busca (debounce), filtros, "carregar mais", e que stats batem.

**Step 7: Commit**

```bash
git add src/components/LeadsDashboard.tsx src/lib/use-debounced.ts
git commit -m "feat(leads): dashboard paginado com filtros e facetas no servidor"
```

> **Atenção a consumidores do shape antigo:** procurar por `data.leads` em outros componentes/usos de `/api/leads` (`grep`). `InboxView` usa `/api/inbox`, não impacta; confirmar `DashboardView`. Ajustar quem esperava `{ leads }` para `{ items }`.

---

### Task 1.5: Paginar as demais listagens (campanhas, consultant, export)

**Files:**
- Modify: `src/server/services/campaign.service.ts` (`listCampaigns`)
- Modify: `src/server/services/consultant.service.ts` (`listConsultantLeads`)
- Modify: `src/server/services/user.service.ts` (`exportUserData`)
- Modify: rotas/consumidores correspondentes

**Step 1: `listConsultantLeads` (mais simples, tabela global)**

```typescript
export async function listConsultantLeads(skip = 0, take = 50) {
  const t = Math.min(take, 100);
  const [items, total] = await Promise.all([
    prisma.consultantLead.findMany({ orderBy: { createdAt: "desc" }, skip, take: t }),
    prisma.consultantLead.count(),
  ]);
  return { items, total };
}
```

Atualizar a rota admin que a consome para repassar `skip/take` e ler `{ items, total }`.

**Step 2: `listCampaigns` — adicionar `skip/take`**

Manter as 3 agregações (`groupBy`) mas só para os ids da página atual. Retornar `{ items, total }`. Atualizar `CampaignsView`.

**Step 3: `exportUserData` — exportar em lotes (stream)**

Trocar `include: { leads: { include: { messages: true } } }` (que carrega tudo em memória) por exportação paginada: buscar leads em páginas de 1000 e montar a saída por chunks. Se a rota for download, usar `ReadableStream` em vez de um único `JSON.stringify`.

```typescript
// Esboço: itera páginas até esvaziar
const PAGE = 1000;
for (let s = 0; ; s += PAGE) {
  const batch = await prisma.lead.findMany({
    where: { userId }, skip: s, take: PAGE,
    include: { messages: true, qualification: true, meeting: true, campaign: { select: { id: true, name: true } } },
  });
  if (batch.length === 0) break;
  // emitir batch no stream / acumular controladamente
}
```

**Step 4: Testes mínimos**

Para `listConsultantLeads` e `listCampaigns`: teste de cap de `take` e shape `{items,total}` (mesmo padrão da Task 1.1).

**Step 5: Rodar suíte + commit**

```bash
npm test
git add -A
git commit -m "feat(listagens): paginar campanhas/consultant e exportar leads em lotes"
```

---

## Fase 2 — Camada de cache (Redis)

**Pré-requisito:** `REDIS_URL` provisionado (web + worker). Instalar cliente:

```bash
npm install ioredis
```

### Task 2.1: Cliente Redis singleton + helpers

**Files:**
- Create: `src/server/cache/redis.ts`
- Create: `src/server/cache/cache.ts` (helpers `cached`, `invalidate`)
- Test: `src/server/cache/cache.test.ts`

**Step 1: Singleton (padrão do Prisma client)**

```typescript
import Redis from "ioredis";
const g = globalThis as unknown as { redis?: Redis };
export const redis =
  g.redis ?? (process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null);
if (process.env.NODE_ENV !== "production" && redis) g.redis = redis;
```

> `redis` pode ser `null` (sem env) — os helpers devem degradar para "sem cache" (chamar a fonte direto). Isso mantém dev/local funcionando sem Redis.

**Step 2: Helper `cached` com fallback**

```typescript
export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  if (!redis) return fn();
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;
  const val = await fn();
  await redis.set(key, JSON.stringify(val), "EX", ttlSec);
  return val;
}
export async function invalidate(...keys: string[]) {
  if (redis && keys.length) await redis.del(...keys);
}
```

**Step 3: Teste do fallback (sem Redis chama a fn)**

```typescript
it("sem REDIS_URL, cached() chama a fonte", async () => {
  vi.resetModules();
  delete process.env.REDIS_URL;
  const { cached } = await import("./cache");
  const fn = vi.fn().mockResolvedValue(42);
  expect(await cached("k", 60, fn)).toBe(42);
  expect(fn).toHaveBeenCalledOnce();
});
```

**Step 4: Rodar + commit**

```bash
npm test -- cache
git add src/server/cache package.json package-lock.json
git commit -m "feat(cache): cliente Redis + helpers cached/invalidate com fallback"
```

---

### Task 2.2: Cachear contadores de inbox e facetas; invalidar nas escritas

**Files:**
- Modify: `src/server/services/inbox.service.ts` (envolver `inboxCounts` em `cached`, chave por `tenantUserId`, TTL 30s)
- Modify: `src/server/services/lead-facets.service.ts` (cachear, TTL 60s)
- Modify: pontos de escrita de lead/mensagem/atribuição → `invalidate`

**Step 1:** Envolver as leituras caras com `cached("inbox:counts:" + tenantUserId, 30, …)` e `cached("leads:facets:" + tenantUserId, 60, …)`.

**Step 2:** Em cada mutação relevante (criar/editar/excluir lead, mover status, ingest de inbound, assign/resolve), chamar `invalidate("inbox:counts:"+t, "leads:facets:"+t)`.

**Step 3:** Validar manualmente que o contador atualiza após ação (≤ TTL) e que a carga no Postgres cai (logs).

**Step 4: Commit**

```bash
git add -A
git commit -m "perf(cache): cachear contadores de inbox e facetas com invalidação nas escritas"
```

---

### Task 2.3: Cache do contexto de conversa (worker + web)

**Files:**
- Modify: `src/server/services/conversation.service.ts` (`loadConversation`)

**Step 1:** Cachear `loadConversation(leadId)` por `conv:<leadId>` com TTL 300s.
**Step 2:** Invalidar (`redis.del("conv:"+leadId)`) ao gravar `Message` INBOUND/OUTBOUND no `ingestInbound` e no envio.
**Step 3:** Garantir o fallback sem Redis (worker em dev).

**Step 4: Commit**

```bash
git add src/server/services/conversation.service.ts
git commit -m "perf(ia): cachear contexto de conversa por lead com invalidação no inbound/outbound"
```

---

## Fase 3 — Disparo de campanha assíncrono, em lote e idempotente

**Contexto:** `startCampaign` já enfileira via `OutboundJob` e delega o envio ao worker (bom), mas carrega **todos** os leads em memória (`include.leads`) e cria um único `createMany` gigante dentro da request; sem idempotência se o operador clicar duas vezes.

### Task 3.1: Idempotência por status

**Files:**
- Modify: `src/server/services/campaign.service.ts` (`startCampaign`)
- Test: `src/server/services/campaign.service.test.ts`

**Step 1: Teste — campanha já RUNNING não reenfileira**

```typescript
it("campanha já RUNNING não cria novos jobs", async () => {
  const { prisma } = await import("@/server/db/client");
  (prisma.campaign.findFirst as any).mockResolvedValue({ id: "c1", status: "RUNNING" });
  const { startCampaign } = await import("./campaign.service");
  const r = await startCampaign("c1", "user-1");
  expect(r.enqueued).toBe(0);
});
```

(mockar `assertFeature` ou injetar; ajustar conforme deps reais.)

**Step 2: Implementar guarda**

No início, após buscar a campanha: se `campaign.status === "RUNNING"`, retornar `{ enqueued: 0 }` sem reprocessar.

**Step 3: Rodar + commit**

```bash
npm test -- campaign.service
git add src/server/services/campaign.service.ts src/server/services/campaign.service.test.ts
git commit -m "feat(campanha): idempotência — não reenfileirar campanha em RUNNING"
```

---

### Task 3.2: Enfileiração em lotes (sem carregar tudo em memória)

**Files:**
- Modify: `src/server/services/campaign.service.ts` (`startCampaign`)

**Step 1: Marcar RUNNING + iterar leads disparáveis em páginas de 500**

```typescript
await prisma.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING" } });
const BATCH = 500;
let enqueued = 0;
for (let skip = 0; ; skip += BATCH) {
  const leads = await prisma.lead.findMany({
    where: { campaignId, status: { in: DISPATCHABLE_LEAD_STATUSES }, optOut: false },
    skip, take: BATCH, select: { id: true, name: true },
  });
  if (leads.length === 0) break;
  const { count } = await prisma.outboundJob.createMany({
    data: leads.map((lead) => ({
      leadId: lead.id, campaignId,
      kind: useTemplate ? "template" : "freeform",
      content: renderTemplate(renderSpintax(campaign.messageTemplate), lead.name),
      templateName: useTemplate ? env.WHATSAPP_TEMPLATE_NAME : null,
    })),
  });
  enqueued += count;
}
return { enqueued };
```

> Os leads já têm `campaignId` setado (a associação acontece em `updateCampaign`/`createCampaign`). Confirmar que `startCampaign` filtra por `campaignId` e não por uma lista carregada — ajustar se a associação só existir em memória.

**Step 2: Validar manualmente com campanha de muitos leads (usar `seed:test`)**

Run: `npm run seed:test` (se aplicável) → iniciar campanha → confirmar jobs `PENDING` criados e request rápida.

**Step 3: Commit**

```bash
git add src/server/services/campaign.service.ts
git commit -m "perf(campanha): enfileirar OutboundJobs em lotes de 500 sem carregar tudo em memória"
```

---

## Fase 4 — Render do frontend (memo + virtualização)

### Task 4.1: `React.memo` nas listas

**Files:**
- Modify: `src/components/LeadsTable.tsx`, `src/components/PipelineBoard.tsx`, `src/components/inbox/ConversationListItem.tsx`

**Step 1:** Envolver cada componente de item/lista em `React.memo` com comparador raso por `id` + campos que mudam visualmente (status, unread, lastMessageAt, active).
**Step 2:** Estabilizar callbacks (`useCallback`) nos pais para não quebrar o memo (`onSelect`, `onMove`, `onEdit`).
**Step 3:** Validar com React DevTools Profiler que digitar na busca não re-renderiza todos os cards.

**Step 4: Commit**

```bash
git add -A
git commit -m "perf(ui): memoizar listas de leads/kanban/inbox e estabilizar callbacks"
```

---

### Task 4.2: Virtualização das listas grandes

**Files:**
- Modify: `src/components/PipelineBoard.tsx` (colunas do kanban), `src/components/inbox/ConversationList.tsx`, `src/components/LeadsTable.tsx`

**Step 1:** `npm install @tanstack/react-virtual` (API moderna, leve, compatível com React 19).
**Step 2:** Virtualizar cada coluna do kanban e a lista do inbox (renderizar só o que está visível). Manter drag-and-drop funcionando (testar).
**Step 3:** Validar scroll suave com 1000+ itens.

**Step 4: Commit**

```bash
git add -A
git commit -m "perf(ui): virtualizar kanban, tabela de leads e lista do inbox"
```

---

## Fase 5 — Tempo real: substituir polling por push (SSE)

**Contexto:** Polling de 3-4s em várias telas multiplica carga. SSE (Server-Sent Events) é o caminho mais simples no App Router (unidirecional, suficiente para "atualizou, recarregue/aplique delta").

### Task 5.1: Endpoint SSE de eventos por tenant

**Files:**
- Create: `src/app/api/stream/route.ts` (SSE, `ReadableStream`)
- Create: `src/server/events/bus.ts` (publish via Redis pub/sub por `tenantUserId`)

**Step 1:** Publisher: ao gravar inbound/outbound/mudança de lead, `redis.publish("tenant:"+tenantUserId, JSON.stringify({type, ...}))`.
**Step 2:** Rota SSE: assina o canal do tenant logado e faz `enqueue` dos eventos. Heartbeat a cada 25s.
**Step 3:** Hook `useTenantStream` no front que escuta e dispara revalidação dirigida (em vez de `setInterval`).

**Step 2/3 detalhe:** Manter polling como fallback (se `EventSource` falhar), mas com intervalo de 30s.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(realtime): SSE por tenant substituindo polling agressivo"
```

> Esta fase é a mais arriscada (conexões persistentes no Railway, limites do pgbouncer não afetam Redis pub/sub). Validar comportamento de reconexão e custo de conexões abertas antes de remover o polling de vez.

---

## Fase 6 — Endurecimento

### Task 6.1: Rate limiting nas rotas críticas

**Files:**
- Create: `src/lib/ratelimit.ts` (sliding window via Redis)
- Modify: `src/app/api/campaigns/[id]/start/route.ts`, rotas de envio/criação em massa

**Step 1:** Implementar limiter por `tenantUserId` (ex.: 10/min em `start`). Sem Redis → no-op (degrada).
**Step 2:** Aplicar nas rotas que disparam trabalho pesado; retornar `429` ao exceder.
**Step 3:** Teste do limiter (contagem incrementa, bloqueia no limite).

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(seg): rate limiting por conta nas rotas de disparo em massa"
```

---

### Task 6.2: Observabilidade — pino + Sentry

**Files:**
- Create: `src/lib/logger.ts` (pino — já está em `dependencies`)
- Modify: trocar `console.*` por `logger.*` no worker e rotas críticas
- (Opcional) `@sentry/nextjs` para captura de exceções

**Step 1:** Criar `logger` pino estruturado (nível por `LOG_LEVEL`).
**Step 2:** Substituir `console.log/error` em `src/server/worker/run.ts`, webhook do WhatsApp e rotas de campanha por logs com contexto (`{ leadId, campaignId, action }`).
**Step 3:** (Opcional) inicializar Sentry e `captureException` nos `catch` das rotas.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(obs): logging estruturado com pino (e Sentry opcional)"
```

---

### Task 6.3: Migrations versionadas

**Files:**
- Create: `prisma/migrations/**`
- Modify: comando de deploy (Railway / `nixpacks.toml` / `railway*.json`)

**Step 1:** `npx prisma migrate dev --name baseline` (gera o baseline a partir do schema atual). Garantir que o estado do banco de produção é compatível (introspect/`migrate resolve` se necessário).
**Step 2:** Trocar o `startCommand` de produção de `prisma db push --accept-data-loss` para `prisma migrate deploy`.
**Step 3:** Documentar o fluxo no README (editar schema → `migrate dev` → commit → deploy roda `migrate deploy`).

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(db): migrations versionadas + deploy via prisma migrate deploy"
```

> Atualizar a memória `crm-inbox-db-push-pending` após isso.

---

## Ordem recomendada e dependências

1. **Fase 0** (independente, faça já).
2. **Fase 1** (base de tudo; 1.1→1.5 em ordem).
3. **Fase 2** (depende de Redis provisionado).
4. **Fase 3** (independente de 1-2, mas melhor depois).
5. **Fase 4** (frontend; depende de 1.4 para o novo shape).
6. **Fase 5** (depende de Redis da Fase 2).
7. **Fase 6** (rate limit/obs/migrations; 6.1 depende de Redis).

**Maior impacto x menor risco:** Fase 0 + Fase 1 + Tasks 2.1/2.2 já derrubam a carga no Postgres em mais de uma ordem de magnitude e melhoram muito a percepção de velocidade.

## Verificação geral ao final de cada fase

- `npm test` (suíte verde)
- `npm run lint`
- `npm run build` (sem erros de tipo/SSR)
- Smoke manual da área afetada (`npm run dev`)
