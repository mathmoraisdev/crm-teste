# Trava de Atendimento por Conversa (anti-colisão event-driven) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Substituir a presença por heartbeat (que queima ~515k comandos Redis/mês) por uma trava de atendimento por conversa guardada no Postgres, com modelo "assumir na hora + avisa".

**Architecture:** Cada `Lead` ganha `attendingUserId`/`attendingAt`. Ao abrir uma conversa o atendente **reivindica** (claim) a trava se estiver livre; se estiver com outro, o front mostra "Fulano está atendendo" + botão **Assumir** (takeover imediato, avisa o anterior via SSE). Ao fechar, **libera** (release). O "quem está atendendo" vem de graça na mesma query que a lista do inbox já roda — sem Redis, sem query extra. O Redis deixa de ter qualquer consumidor de alta frequência.

**Tech Stack:** Next.js (App Router, route handlers), Prisma + Postgres (Supabase), Vitest (mock de prisma), SSE via `publishTenantEvent` (já existente). Sem libs novas.

---

## Contexto que o executor precisa saber

- **Testes:** o projeto testa **serviços** (Vitest, mockando `@/server/db/client`), não componentes React. Siga TDD nos serviços; no front (`InboxView.tsx`) a verificação é manual (rodar o app).
- **Tenancy:** `getTenantContext()` devolve `{ tenantUserId, sessionUserId }`. `tenantUserId` = a conta (dono); `sessionUserId` = o operador logado (pode ser o dono ou um seat). A trava é por `sessionUserId`.
- **Realtime:** `publishTenantEvent(tenantUserId, { type, leadId })` publica no canal da conta; o front (`useTenantStream`) recarrega lista+detalhe em **qualquer** evento (não faz switch por `type`). Reusaremos `type: "conversation:changed"`.
- **Deploy PROD (ver memórias):** mudança COM pasta de migration → o build/worker roda `prisma migrate deploy` no boot; **torne o SQL idempotente** (`IF NOT EXISTS`) e **não** rode SQL manual redundante. Web via Vercel CLI, worker via `git pull` + `systemctl restart crm-worker` no Oracle.
- **Corrida:** claim/release usam `updateMany` condicional (não `update` + leitura) pra serializar dois operadores no mesmo tick.

---

## Task 1: Schema — coluna de atendimento no Lead

**Files:**
- Modify: `prisma/schema.prisma` (model `Lead`, model `User`)
- Create: `prisma/migrations/<timestamp>_lead_attending/migration.sql`

**Step 1: Adicionar os campos e a relação no schema**

No `model Lead`, junto dos outros campos de atribuição (perto de `assignedTo`/`assignedToId`), adicione:

```prisma
  // Anti-colisão event-driven: quem está com a conversa aberta AGORA (trava de
  // atendimento). Diferente de assignedToId (dono do lead, durável) — isto é
  // efêmero e muda a cada abertura/assumir/fechar. Ver docs/plans/2026-07-08-trava-atendimento-conversa.md
  attendingUserId String?
  attendingAt     DateTime?
  attendingTo     User?     @relation("LeadAttendedBy", fields: [attendingUserId], references: [id], onDelete: SetNull)
```

No `model User`, adicione o lado inverso da relação (junto das outras relações de Lead, ex.: onde já existe a relação de `assignedTo`):

```prisma
  attendingLeads Lead[] @relation("LeadAttendedBy")
```

**Step 2: Gerar a migration (dev)**

> ⚠️ Pare o `next dev` antes (Windows trava a DLL do query-engine no generate — ver memória `prisma-generate-dev-server-lock`).

Run: `npx prisma migrate dev --name lead_attending`
Expected: cria a pasta de migration e aplica no Postgres local (Docker `crm-postgres`).

**Step 3: Tornar o SQL idempotente (pra PROD não colidir)**

Edite o `migration.sql` gerado para usar `IF NOT EXISTS` nas colunas (o índice do FK o Prisma cria; deixe como veio, mas garanta as colunas idempotentes):

```sql
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "attendingUserId" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "attendingAt" TIMESTAMP(3);
-- FK (idempotência via checagem de constraint):
DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_attendingUserId_fkey"
    FOREIGN KEY ("attendingUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

**Step 4: Regenerar o client e checar tipos**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: sem erros; `Lead.attendingUserId`/`attendingTo` disponíveis no tipo.

**Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(inbox): coluna de atendimento (trava por conversa) no Lead"
```

---

## Task 2: Serviço da trava (claim / takeover / release)

**Files:**
- Create: `src/server/services/attendance-lock.service.ts`
- Test: `src/server/services/attendance-lock.service.test.ts`

**Step 1: Escrever os testes que falham**

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { updateMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/server/events/bus", () => ({ publishTenantEvent: vi.fn().mockResolvedValue(undefined) }));

async function mods() {
  return {
    prisma: (await import("@/server/db/client")).prisma as any,
    publish: (await import("@/server/events/bus")).publishTenantEvent as any,
    svc: await import("./attendance-lock.service"),
  };
}

beforeEach(() => vi.clearAllMocks());

const NOW = new Date("2026-07-08T12:00:00.000Z");

describe("claimConversation", () => {
  it("livre (ou já minha) → reivindica e publica", async () => {
    const m = await mods();
    m.prisma.lead.updateMany.mockResolvedValue({ count: 1 }); // conseguiu a trava
    const r = await m.svc.claimConversation({
      leadId: "L1", tenantUserId: "T", userId: "ana", now: NOW,
    });
    expect(m.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: "L1", OR: [{ attendingUserId: null }, { attendingUserId: "ana" }] },
      data: { attendingUserId: "ana", attendingAt: NOW },
    });
    expect(r).toEqual({ ok: true, heldBy: null });
    expect(m.publish).toHaveBeenCalledWith("T", { type: "conversation:changed", leadId: "L1" });
  });

  it("ocupada por outro → NÃO rouba, devolve quem segura", async () => {
    const m = await mods();
    m.prisma.lead.updateMany.mockResolvedValue({ count: 0 }); // não conseguiu
    m.prisma.lead.findFirst.mockResolvedValue({
      attendingUserId: "beto", attendingAt: NOW, attendingTo: { id: "beto", name: "Beto" },
    });
    const r = await m.svc.claimConversation({
      leadId: "L1", tenantUserId: "T", userId: "ana", now: NOW,
    });
    expect(m.prisma.lead.update).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, heldBy: { userId: "beto", name: "Beto", since: NOW } });
    expect(m.publish).not.toHaveBeenCalled(); // nada mudou
  });
});

describe("takeoverConversation", () => {
  it("assume à força e publica (o anterior recebe o evento)", async () => {
    const m = await mods();
    m.prisma.lead.update.mockResolvedValue({});
    await m.svc.takeoverConversation({ leadId: "L1", tenantUserId: "T", userId: "ana", now: NOW });
    expect(m.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: "L1" },
      data: { attendingUserId: "ana", attendingAt: NOW },
    });
    expect(m.publish).toHaveBeenCalledWith("T", { type: "conversation:changed", leadId: "L1" });
  });
});

describe("releaseConversation", () => {
  it("libera SÓ se eu ainda seguro (não apaga trava de quem assumiu)", async () => {
    const m = await mods();
    m.prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    await m.svc.releaseConversation({ leadId: "L1", tenantUserId: "T", userId: "ana" });
    expect(m.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: "L1", attendingUserId: "ana" },
      data: { attendingUserId: null, attendingAt: null },
    });
    expect(m.publish).toHaveBeenCalledWith("T", { type: "conversation:changed", leadId: "L1" });
  });

  it("já não era minha (outro assumiu) → count 0, não publica", async () => {
    const m = await mods();
    m.prisma.lead.updateMany.mockResolvedValue({ count: 0 });
    await m.svc.releaseConversation({ leadId: "L1", tenantUserId: "T", userId: "ana" });
    expect(m.publish).not.toHaveBeenCalled();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/attendance-lock.service.test.ts`
Expected: FAIL ("Cannot find module ./attendance-lock.service").

**Step 3: Implementar o serviço**

```ts
import { prisma } from "@/server/db/client";
import { publishTenantEvent } from "@/server/events/bus";

/**
 * Trava de atendimento por conversa (anti-colisão event-driven). Substitui a
 * presença por heartbeat: escreve SÓ em transições (abrir/assumir/fechar), não num
 * timer. O "quem atende" é lido de graça na query da lista do inbox (coluna no Lead).
 * Modelo "assumir na hora": claim só pega se livre; ocupado → o front oferece Assumir.
 */

export interface LockHolder {
  userId: string;
  name: string;
  since: Date | null;
}

export interface ClaimResult {
  ok: boolean;
  /** preenchido quando ok=false: quem já está atendendo */
  heldBy: LockHolder | null;
}

/** Reivindica a trava se estiver livre (ou já for minha). Ocupada por outro → não rouba. */
export async function claimConversation(args: {
  leadId: string;
  tenantUserId: string;
  userId: string;
  now?: Date;
}): Promise<ClaimResult> {
  const now = args.now ?? new Date();
  // updateMany condicional serializa dois operadores no mesmo tick: só um vê count=1.
  const res = await prisma.lead.updateMany({
    where: { id: args.leadId, OR: [{ attendingUserId: null }, { attendingUserId: args.userId }] },
    data: { attendingUserId: args.userId, attendingAt: now },
  });
  if (res.count === 1) {
    await publishTenantEvent(args.tenantUserId, { type: "conversation:changed", leadId: args.leadId });
    return { ok: true, heldBy: null };
  }
  // Ocupada por outro: devolve quem segura (pro front mostrar "Fulano está atendendo").
  const lead = await prisma.lead.findFirst({
    where: { id: args.leadId },
    select: { attendingUserId: true, attendingAt: true, attendingTo: { select: { id: true, name: true } } },
  });
  const holder = lead?.attendingTo
    ? { userId: lead.attendingTo.id, name: lead.attendingTo.name, since: lead.attendingAt ?? null }
    : null;
  return { ok: false, heldBy: holder };
}

/** Assume à força (takeover). O atendente anterior é avisado pelo evento publicado. */
export async function takeoverConversation(args: {
  leadId: string;
  tenantUserId: string;
  userId: string;
  now?: Date;
}): Promise<void> {
  await prisma.lead.update({
    where: { id: args.leadId },
    data: { attendingUserId: args.userId, attendingAt: args.now ?? new Date() },
  });
  await publishTenantEvent(args.tenantUserId, { type: "conversation:changed", leadId: args.leadId });
}

/** Libera a trava — SÓ se eu ainda for o dono (não apaga a trava de quem assumiu). */
export async function releaseConversation(args: {
  leadId: string;
  tenantUserId: string;
  userId: string;
}): Promise<void> {
  const res = await prisma.lead.updateMany({
    where: { id: args.leadId, attendingUserId: args.userId },
    data: { attendingUserId: null, attendingAt: null },
  });
  if (res.count === 1) {
    await publishTenantEvent(args.tenantUserId, { type: "conversation:changed", leadId: args.leadId });
  }
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/attendance-lock.service.test.ts`
Expected: PASS (6 testes).

**Step 5: Commit**

```bash
git add src/server/services/attendance-lock.service.ts src/server/services/attendance-lock.service.test.ts
git commit -m "feat(inbox): serviço da trava de atendimento (claim/takeover/release)"
```

---

## Task 3: Lista do inbox — atendimento vem da query, sem Redis

**Files:**
- Modify: `src/server/services/inbox.service.ts` (~110-160)
- Modify: o tipo `InboxConversation` (mesmo arquivo, campo `viewers` → `attendingBy`)
- Test: `src/server/services/inbox.service.test.ts` (se existir; senão, cobertura pelo Task 2 + verificação manual)

**Step 1: Trocar a fonte do "quem atende"**

No `prisma.lead.findMany({ include: {...} })` (linha ~113), adicione ao `include`:

```ts
        attendingTo: { select: { id: true, name: true } },
```

Remova a chamada `whoIsViewingMany` (linha ~137-139) e o import de `presence.service`. No map das linhas (`rows`), troque:

```ts
      viewers: viewersByLead[l.id] ?? [],
```

por:

```ts
      // Trava de atendimento (anti-colisão): quem está com a conversa aberta agora.
      // Vem de graça no include — sem Redis. Não mostra a si mesmo.
      attendingBy:
        l.attendingUserId && l.attendingUserId !== opts.sessionUserId && l.attendingTo
          ? { userId: l.attendingTo.id, name: l.attendingTo.name, since: l.attendingAt }
          : null,
```

**Step 2: Atualizar o tipo `InboxConversation`**

Troque o campo `viewers: Viewer[]` por:

```ts
  attendingBy: { userId: string; name: string; since: Date | null } | null;
```

Remova o import `import { whoIsViewingMany, type Viewer } ...`.

**Step 3: Checar tipos**

Run: `npx tsc --noEmit`
Expected: erros SÓ nos consumidores do front que usam `viewers` (resolvidos na Task 5). Anote-os.

**Step 4: Commit**

```bash
git add src/server/services/inbox.service.ts
git commit -m "feat(inbox): lê atendimento da query da lista (remove presença Redis)"
```

---

## Task 4: Rota de atendimento (claim / takeover / release)

**Files:**
- Create: `src/app/api/inbox/[id]/attendance/route.ts`
- Delete: `src/app/api/inbox/[id]/presence/route.ts`

**Step 1: Criar a nova rota**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/server/db/client";
import {
  claimConversation,
  takeoverConversation,
  releaseConversation,
} from "@/server/services/attendance-lock.service";

export const dynamic = "force-dynamic";

/**
 * Trava de atendimento da conversa. POST {action:"claim"|"takeover"} ao abrir/assumir;
 * DELETE ao fechar. Substitui o heartbeat de presença (que batia a cada 15s no Redis).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;

  // Escopo de tenant: a conversa é da conta?
  const lead = await prisma.lead.findFirst({
    where: { id, userId: ctx.tenantUserId },
    select: { id: true },
  });
  if (!lead) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "takeover") {
    await takeoverConversation({ leadId: id, tenantUserId: ctx.tenantUserId, userId: ctx.sessionUserId });
    return NextResponse.json({ ok: true });
  }
  const r = await claimConversation({ leadId: id, tenantUserId: ctx.tenantUserId, userId: ctx.sessionUserId });
  return NextResponse.json(r);
}

/** Sai da conversa: libera a trava (só se ainda for minha). keepalive no front. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  await releaseConversation({ leadId: id, tenantUserId: ctx.tenantUserId, userId: ctx.sessionUserId });
  return NextResponse.json({ ok: true });
}
```

**Step 2: Apagar a rota de presença antiga**

Run: `git rm src/app/api/inbox/[id]/presence/route.ts`

**Step 3: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem novos erros (fora os do front, Task 5).

**Step 4: Commit**

```bash
git add src/app/api/inbox
git commit -m "feat(inbox): rota de trava de atendimento; remove rota de presença"
```

---

## Task 5: Front — claim ao abrir, banner de Assumir, aviso ao ser assumido

**Files:**
- Modify: `src/components/inbox/InboxView.tsx` (~101-115 heartbeat; consumidores de `viewers`)
- Modify: qualquer componente que renderiza `viewers` (buscar por `viewers` em `src/components/inbox/`)

**Step 1: Remover o heartbeat de presença**

Apague o `useEffect` do heartbeat (linhas ~101-115, o `setInterval(beat, 15000)`).

**Step 2: Claim ao selecionar + release ao sair**

No lugar, um efeito que reivindica ao abrir e libera ao fechar/trocar. Guarda em ref se EU seguro a trava (pra detectar o bump depois):

```tsx
  const iHoldRef = useRef(false);
  const [heldByOther, setHeldByOther] = useState<{ userId: string; name: string } | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    setHeldByOther(null);
    iHoldRef.current = false;
    fetch(`/api/inbox/${id}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    })
      .then((r) => r.json())
      .then((r: { ok: boolean; heldBy: { userId: string; name: string } | null }) => {
        if (r.ok) iHoldRef.current = true;
        else setHeldByOther(r.heldBy);
      })
      .catch(() => {});
    return () => {
      iHoldRef.current = false;
      fetch(`/api/inbox/${id}/attendance`, { method: "DELETE", keepalive: true }).catch(() => {});
    };
  }, [selectedId]);
```

**Step 3: Botão "Assumir" quando ocupada**

Onde renderiza o cabeçalho/painel central da conversa, quando `heldByOther` não é null, mostre um banner:

```tsx
  {heldByOther && (
    <div className="flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
      <span>🔒 {heldByOther.name} está atendendo esta conversa.</span>
      <button
        className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white"
        onClick={async () => {
          await fetch(`/api/inbox/${selectedId}/attendance`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "takeover" }),
          }).catch(() => {});
          iHoldRef.current = true;
          setHeldByOther(null);
        }}
      >
        Assumir
      </button>
    </div>
  )}
```

**Step 4: Aviso quando OUTRO assume a minha conversa aberta**

No callback do `useTenantStream` (que já recarrega lista+detalhe), depois do reload detecte o bump: se eu segurava e o `detail.attendingBy` agora aponta pra outro, avise. Ajuste `loadDetail` pra trazer `attendingBy` no `/api/leads/[id]` (ou compare pela lista). Padrão mínimo: ao receber evento, se `iHoldRef.current` e a lista mostra a conversa aberta com `attendingBy` != null (outro), dispare um toast e limpe:

```tsx
  useTenantStream(() => {
    loadList(filter);
    if (selectedRef.current) loadDetail(selectedRef.current);
    // bump: eu segurava e alguém assumiu → avisa e solta o meu estado local
    const row = listRef.current.find((c) => c.id === selectedRef.current);
    if (iHoldRef.current && row?.attendingBy) {
      iHoldRef.current = false;
      setHeldByOther({ userId: row.attendingBy.userId, name: row.attendingBy.name });
      toast(`🔔 ${row.attendingBy.name} assumiu esta conversa`); // use o helper de toast do projeto
    }
  });
```

> Se não houver `listRef`, adicione um `useRef` espelhando o estado da lista (padrão já usado com `selectedRef`). Use o mecanismo de toast existente no projeto (procure por `toast`/`sonner`/notificação); se não houver, um banner basta.

**Step 5: Trocar o indicador antigo `viewers` por `attendingBy`**

Procure por `viewers` em `src/components/inbox/`:

Run: `git grep -n "viewers" -- src/components`

Em cada uso na lista (ex.: um selo "👁 Fulano"), troque por `attendingBy` (agora é objeto único ou null): mostrar `🔒 {attendingBy.name}` quando não-nulo.

**Step 6: Verificação manual (dois operadores)**

Run: `npm run dev` (pare antes qualquer generate)
- Logar como dois usuários da mesma conta (dois navegadores/perfil anônimo).
- A abre a conversa X → B abre X → B vê "🔒 A está atendendo" + [Assumir].
- B clica Assumir → B passa a segurar; A vê o aviso "B assumiu".
- A fecha a aba sem soltar (crash simulado) → B abre e ainda consegue Assumir (nunca fica preso).
Expected: todos os passos OK; nenhuma chamada a `/presence`.

**Step 7: Commit**

```bash
git add src/components/inbox
git commit -m "feat(inbox): claim ao abrir + Assumir + aviso; remove heartbeat de presença"
```

---

## Task 6: Remover a presença por Redis (código morto)

**Files:**
- Delete: `src/server/services/presence.service.ts`, `src/server/services/presence.service.test.ts`
- Modify: qualquer import remanescente (a busca abaixo confirma)

**Step 1: Confirmar que ninguém mais usa**

Run: `git grep -n "presence.service\|whoIsViewing\|heartbeat(" -- src`
Expected: só o próprio arquivo (e o teste). Se aparecer outro consumidor, resolva antes de apagar.

**Step 2: Apagar**

Run: `git rm src/server/services/presence.service.ts src/server/services/presence.service.test.ts`

**Step 3: Limpar o tipo `Viewer` órfão / evento `presence:changed`**

- Em `src/server/events/bus.ts`, remova `"presence:changed"` do union `TenantEvent["type"]` (ninguém mais publica).
- Remova imports/exports de `Viewer` que ficaram órfãos.

**Step 4: Gate completo — suíte + tipos**

Run: `npx tsc --noEmit && npx vitest run`
Expected: verde (nenhum teste referencia presença).

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(inbox): remove presença por heartbeat (Redis) — substituída pela trava no Postgres"
```

---

## Task 7: Verificação de custo + deploy

**Step 1: Confirmar que o Redis não é mais tocado no fluxo do inbox**

Run: `git grep -n "redis\|Redis" -- src/server/services/inbox.service.ts src/app/api/inbox`
Expected: nenhum resultado (o inbox não fala mais com Redis; sobra só cache/rate-limit/SSE em outros pontos).

**Step 2: Deploy web (Vercel CLI)**

Sem schema novo pro front, mas a migration precisa ir junto — o worker aplica no boot. Faça o push primeiro:

```bash
git push origin master
env -u CLAUDECODE CI=1 VERCEL_TOKEN=<token> npx vercel deploy --prod --yes --token=<token>
```

**Step 3: Deploy worker (Oracle) — aplica a migration**

```bash
ssh -i ~/.ssh/oracle-crm ubuntu@136.248.93.142 'cd /opt/crm && git reset --hard origin/master && sudo systemctl restart crm-worker'
```
Verifique no log: `migrate deploy` aplicou `lead_attending` (ou "No pending" se já aplicada), worker `active`, Baileys reconectado.

**Step 4: Verificar no console do Upstash (dias depois)**

O contador mensal de comandos deve **cair drasticamente** (o consumo de presença some; sobra só SSE/cache/rate-limit, proporcional a atividade real). Objetivo: voltar a caber no free (500k).

**Step 5: Atualizar memória**

Registre em memória: presença por heartbeat aposentada; trava de atendimento no Postgres (`Lead.attendingUserId/attendingAt`), modelo assumir-na-hora; motivo = corte de custo Redis. Linkar `[[inbox-produtivo-feito]]` e a memória do teto do Upstash.

---

## Notas de design (por que assim)

- **Assumir-na-hora (não aprovação):** aprovação trava o 2º atendente se o 1º saiu (AFK) → deadlock. Com takeover imediato + aviso, a colisão real (dois digitando pro mesmo cliente) é resolvida sem criar espera.
- **Trava fantasma vira cosmética:** como o takeover é sempre 1 clique, uma trava pendurada (aba que caiu sem soltar) nunca **bloqueia** ninguém — no pior caso mostra um "está atendendo" enganoso até alguém assumir ou o dono voltar. Por isso **não** precisamos de TTL/heartbeat de renovação.
- **Custo:** escreve só em abrir/assumir/fechar. Leitura do "quem atende" vem grátis na query da lista. Redis deixa de ter consumidor de alta frequência → queda esperada de ~50× no volume mensal.
- **YAGNI:** sem aba de config, sem flag por conta — a trava é barata e sempre-ligada; se a conta atende sozinha, o campo só fica sempre com o mesmo dono e não incomoda.
