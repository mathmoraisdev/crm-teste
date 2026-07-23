# Disparo em Massa — Vazão Máxima com Execução Garantida — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir disparo em massa de 1.000–5.000+ leads via Baileys com vazão máxima (risco de ban assumido), garantindo que **nenhum job se perca** e que a fila **conclua ou retome sozinha** quando há chip vivo.

**Architecture:** Mantemos o worker único (2–10 chips por conta), mas trocamos o loop serial "1 job por vez" por **um loop de envio concorrente por chip**. Antes disso, blindamos a durabilidade: lease/reaper de jobs travados em `SENDING`, reroteamento quando um chip bane, cap diário **por conta** (não global), e fim do livelock quando não há chip elegível. Por último, observabilidade (fila/ETA, métricas por chip, heartbeat do worker).

**Tech Stack:** Next.js 15, Prisma 6 + PostgreSQL, `@whiskeysockets/baileys`, worker `tsx` long-lived (Railway), Vitest. Padrão de teste do repo: **extrair função pura → testar a função pura** (ver `selection.test.ts`, `dispatcher.cap.test.ts`).

**Ordem inegociável:** Fase 1 (durabilidade) → Fase 2 (vazão) → Fase 3 (operação). Acelerar antes de blindar só multiplica perda silenciosa.

**Decisões travadas (do briefing):**
- 2–10 chips por conta → worker único com loops paralelos por chip. **Sem sharding multi-worker.**
- Ritmo **agressivo com pacing mínimo**: ~1,5–3s + jitter por chip. Pacing global por env (sem perfil por campanha — YAGNI).
- Caps de segurança viram **soltos/opcionais** (`0` = ilimitado) e **por conta**.

---

## Convenções

- Rodar 1 teste: `npm test -- <arquivo>` (ex.: `npm test -- src/server/worker/reaper.test.ts`).
- Rodar tudo: `npm test`.
- Schema: o repo usa `prisma db push` (sem migrations versionadas). Após editar `schema.prisma`: `npm run db:push` e depois `npm run db:generate`.
- Funções puras (decisão) ficam testáveis sem DB; funções de query (efeito) ficam finas e são chamadas pelas puras. Espelhar o estilo de `dispatcher.ts`.
- Commits frequentes, 1 por task.

---

# FASE 1 — Durabilidade (garantir que nada se perde)

## Task 1: Coluna de lease (`claimedAt`) no OutboundJob

Hoje o claim `PENDING→SENDING` em [dispatcher.ts:121-124](../../src/server/worker/dispatcher.ts#L121-L124) não registra **quando** travou — sem isso não dá para detectar job órfão. Adicionamos `claimedAt`.

**Files:**
- Modify: `prisma/schema.prisma` (model `OutboundJob`)
- Modify: `src/server/worker/dispatcher.ts:121-124`

**Step 1: Editar o schema**

Em `model OutboundJob`, adicionar campo e índice:

```prisma
  status       OutboundJobStatus @default(PENDING)
  attempts     Int               @default(0)
  claimedAt    DateTime?         // quando um worker travou em SENDING (p/ reaper de órfãos)
  lastError    String?
```

E nos `@@index`:

```prisma
  @@index([status, scheduledFor])
  @@index([status, claimedAt]) // reaper varre SENDING órfãos por idade do lease
  @@index([leadId])
  @@index([campaignId])
  @@index([whatsAppNumberId, status, sentAt])
```

**Step 2: Aplicar no banco**

Run: `npm run db:push && npm run db:generate`
Expected: `Your database is now in sync with your Prisma schema.` e client regenerado sem erro.

**Step 3: Gravar `claimedAt` no claim**

Em `dispatcher.ts`, no `updateMany` do claim:

```typescript
  const claim = await prisma.outboundJob.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "SENDING", attempts: { increment: 1 }, claimedAt: now },
  });
```

**Step 4: Verificar build do client**

Run: `npm test -- src/server/worker/dispatcher.cap.test.ts`
Expected: PASS (não quebrou nada — `cappedCampaignIds` é puro).

**Step 5: Commit**

```bash
git add prisma/schema.prisma src/server/worker/dispatcher.ts
git commit -m "feat(durabilidade): adiciona claimedAt p/ lease de OutboundJob"
```

---

## Task 2: Função pura `isReclaimable` (decide se um job travou)

**Files:**
- Create: `src/server/worker/reaper.ts`
- Test: `src/server/worker/reaper.test.ts`

**Step 1: Escrever o teste que falha**

```typescript
// src/server/worker/reaper.test.ts
import { describe, it, expect } from "vitest";
import { isReclaimable } from "./reaper";

const base = {
  status: "SENDING" as const,
  claimedAt: new Date("2026-06-19T12:00:00Z"),
};
const LEASE = 120_000; // 2 min

describe("isReclaimable", () => {
  it("recupera SENDING parado além do lease", () => {
    const now = new Date("2026-06-19T12:03:00Z"); // 3 min depois
    expect(isReclaimable(base, now, LEASE)).toBe(true);
  });

  it("NÃO recupera SENDING dentro do lease", () => {
    const now = new Date("2026-06-19T12:01:00Z"); // 1 min depois
    expect(isReclaimable(base, now, LEASE)).toBe(false);
  });

  it("NÃO recupera job que não está em SENDING", () => {
    const now = new Date("2026-06-19T13:00:00Z");
    expect(isReclaimable({ ...base, status: "SENT" }, now, LEASE)).toBe(false);
  });

  it("recupera SENDING sem claimedAt (legado/inconsistente)", () => {
    const now = new Date("2026-06-19T13:00:00Z");
    expect(isReclaimable({ ...base, claimedAt: null }, now, LEASE)).toBe(true);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npm test -- src/server/worker/reaper.test.ts`
Expected: FAIL (`isReclaimable` não existe).

**Step 3: Implementação mínima**

```typescript
// src/server/worker/reaper.ts
import { prisma } from "@/server/db/client";

export interface ReclaimableJob {
  status: string;
  claimedAt: Date | null;
}

/**
 * Um job em SENDING é "órfão" quando o lease venceu — o worker que o travou
 * provavelmente morreu (deploy/crash) entre o claim e o envio. claimedAt null
 * conta como recuperável (estado inconsistente herdado).
 */
export function isReclaimable(job: ReclaimableJob, now: Date, leaseMs: number): boolean {
  if (job.status !== "SENDING") return false;
  if (!job.claimedAt) return true;
  return now.getTime() - job.claimedAt.getTime() >= leaseMs;
}
```

**Step 4: Rodar e ver passar**

Run: `npm test -- src/server/worker/reaper.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/worker/reaper.ts src/server/worker/reaper.test.ts
git commit -m "feat(durabilidade): isReclaimable detecta jobs SENDING órfãos"
```

---

## Task 3: Query `reclaimStuckJobs` (devolve órfãos à fila)

**Files:**
- Modify: `src/server/worker/reaper.ts`

**Step 1: Implementar a função de efeito**

Adicionar em `reaper.ts`:

```typescript
/**
 * Devolve à fila todo job SENDING cujo lease venceu. Limpa claimedAt e o chip,
 * para que QUALQUER chip vivo possa reprocessar (não fica preso ao número morto).
 * Retorna quantos foram recuperados. Idempotente; seguro rodar com frequência.
 */
export async function reclaimStuckJobs(now: Date, leaseMs: number): Promise<number> {
  const cutoff = new Date(now.getTime() - leaseMs);
  const { count } = await prisma.outboundJob.updateMany({
    where: {
      status: "SENDING",
      OR: [{ claimedAt: { lt: cutoff } }, { claimedAt: null }],
    },
    data: {
      status: "PENDING",
      claimedAt: null,
      whatsAppNumberId: null, // libera p/ rerotear em qualquer chip
      scheduledFor: now,
    },
  });
  return count;
}
```

**Step 2: Verificar que compila**

Run: `npm test -- src/server/worker/reaper.test.ts`
Expected: PASS (testes de `isReclaimable` continuam verdes; a query é coberta na integração).

**Step 3: Commit**

```bash
git add src/server/worker/reaper.ts
git commit -m "feat(durabilidade): reclaimStuckJobs devolve órfãos SENDING à fila"
```

---

## Task 4: Wire do reaper no worker (boot + periódico)

**Files:**
- Modify: `src/server/worker/run.ts`
- Modify: `src/lib/env.ts`

**Step 1: Env do lease**

Em `env.ts`, no schema zod, adicionar:

```typescript
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(120_000), // job SENDING órfão > isto volta à fila
  WORKER_REAP_EVERY_MS: z.coerce.number().int().positive().default(30_000), // frequência do reaper
```

**Step 2: Reaper no boot e no loop**

Em `run.ts`, importar e chamar. No `main()`, **antes** do `while`, rodar uma vez (recupera órfãos de um deploy anterior); dentro do loop, rodar a cada `WORKER_REAP_EVERY_MS`:

```typescript
import { reclaimStuckJobs } from "./reaper";
// ...
  if (env.WHATSAPP_MODE === "baileys") pool = await bootBaileys();

  // Recupera jobs órfãos de execuções anteriores (deploy/crash deixou SENDING preso).
  const reclaimedOnBoot = await reclaimStuckJobs(new Date(), env.WORKER_LEASE_MS);
  if (reclaimedOnBoot > 0) console.log("[worker] reaper boot: %d jobs recuperados", reclaimedOnBoot);

  let lastReap = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - lastReap >= env.WORKER_REAP_EVERY_MS) {
      const n = await reclaimStuckJobs(new Date(), env.WORKER_LEASE_MS);
      if (n > 0) console.log("[worker] reaper: %d jobs recuperados", n);
      lastReap = Date.now();
    }
    // ... resto do loop existente
```

**Step 3: Smoke do worker (manual)**

Run: `npm run worker` (com `.env` apontando p/ banco de dev)
Expected: log `[worker] iniciado...` e, se houver SENDING preso, `reaper boot: N jobs recuperados`. Encerrar com Ctrl+C.

**Step 4: Commit**

```bash
git add src/server/worker/run.ts src/lib/env.ts
git commit -m "feat(durabilidade): worker roda reaper no boot e periodicamente"
```

---

## Task 5: Fim do livelock — `decideNoChipAction`

Hoje, sem chip elegível, o job rebate a cada 30s **para sempre** ([dispatcher.ts:131-142](../../src/server/worker/dispatcher.ts#L131-L142)). Queremos: adiar algumas vezes; se persistir, **pausar a campanha e sinalizar** (não perder, não girar à toa).

**Files:**
- Create: `src/server/worker/nochip.ts`
- Test: `src/server/worker/nochip.test.ts`
- Modify: `src/server/worker/dispatcher.ts:128-144`

**Step 1: Teste que falha**

```typescript
// src/server/worker/nochip.test.ts
import { describe, it, expect } from "vitest";
import { decideNoChipAction } from "./nochip";

describe("decideNoChipAction", () => {
  it("adia enquanto abaixo do limite de tentativas", () => {
    expect(decideNoChipAction(0, 5)).toEqual({ action: "defer" });
    expect(decideNoChipAction(4, 5)).toEqual({ action: "defer" });
  });

  it("pausa a campanha ao atingir o limite (todos os chips fora)", () => {
    expect(decideNoChipAction(5, 5)).toEqual({ action: "pause_campaign" });
    expect(decideNoChipAction(9, 5)).toEqual({ action: "pause_campaign" });
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npm test -- src/server/worker/nochip.test.ts`
Expected: FAIL.

**Step 3: Implementação**

```typescript
// src/server/worker/nochip.ts
export type NoChipAction = { action: "defer" } | { action: "pause_campaign" };

/**
 * Quando a conta não tem chip elegível, adiamos o job. Mas adiar infinitamente
 * é livelock — após `maxDefers` deferimentos consecutivos, a campanha é pausada
 * e o operador é avisado p/ repor chips. A fila NÃO é perdida: ao despausar (ou
 * conectar um chip novo), os PENDING voltam a fluir.
 */
export function decideNoChipAction(deferCount: number, maxDefers: number): NoChipAction {
  return deferCount >= maxDefers ? { action: "pause_campaign" } : { action: "defer" };
}
```

**Step 4: Adicionar contador de defer no job**

Em `schema.prisma`, `model OutboundJob`, adicionar:

```prisma
  attempts     Int               @default(0)
  deferCount   Int               @default(0) // deferimentos por falta de chip (anti-livelock)
```

Run: `npm run db:push && npm run db:generate`
Expected: sync ok.

**Step 5: Aplicar no dispatcher**

Substituir o bloco "Conta sem chip elegível" em `dispatcher.ts` por:

```typescript
    if (!picked) {
      const job = await prisma.outboundJob.findUnique({
        where: { id: candidate.id },
        select: { deferCount: true, campaignId: true },
      });
      const decision = decideNoChipAction((job?.deferCount ?? 0) + 1, env.WORKER_MAX_DEFERS);
      if (decision.action === "pause_campaign" && job?.campaignId) {
        await prisma.$transaction([
          prisma.campaign.update({ where: { id: job.campaignId }, data: { status: "PAUSED" } }),
          prisma.outboundJob.update({
            where: { id: candidate.id },
            data: { status: "PENDING", attempts: { decrement: 1 }, claimedAt: null,
                    lastError: "sem chip vivo — campanha pausada p/ reposição" },
          }),
        ]);
      } else {
        await prisma.outboundJob.update({
          where: { id: candidate.id },
          data: { status: "PENDING", attempts: { decrement: 1 }, claimedAt: null,
                  deferCount: { increment: 1 },
                  scheduledFor: new Date(now.getTime() + 30_000) },
        });
      }
      return false;
    }
```

Adicionar em `env.ts`: `WORKER_MAX_DEFERS: z.coerce.number().int().positive().default(5),` e importar `decideNoChipAction` no dispatcher.

> Nota: quando o envio dá certo, zere `deferCount` (em `dispatchOutboundJob`, no update final do job, adicionar `deferCount: 0`). Assim a contagem é de deferimentos *consecutivos*.

**Step 6: Rodar testes**

Run: `npm test -- src/server/worker/nochip.test.ts`
Expected: PASS.

**Step 7: Commit**

```bash
git add prisma/schema.prisma src/server/worker/nochip.ts src/server/worker/nochip.test.ts src/server/worker/dispatcher.ts src/lib/env.ts
git commit -m "feat(durabilidade): pausa campanha em vez de livelock quando sem chip vivo"
```

---

## Task 6: Reroteamento ao banir um chip

Quando um chip cai como `BANNED` ([pool.ts:88-93](../../src/server/whatsapp/baileys/pool.ts#L88-L93)), os jobs que ele estava processando (`SENDING`) e quaisquer `PENDING` já atribuídos a ele devem voltar ao pool, **sem número**, p/ outro chip pegar.

**Files:**
- Create: `src/server/worker/reroute.ts`
- Test: `src/server/worker/reroute.test.ts` (pura) — opcional, a função é quase só query; testamos a decisão de quais status rerotear
- Modify: `src/server/whatsapp/baileys/pool.ts` (handler `BANNED`)

**Step 1: Função de reroteamento**

```typescript
// src/server/worker/reroute.ts
import { prisma } from "@/server/db/client";

/** Status de jobs que ainda podem ser reenviados (não SENT/FAILED/CANCELLED). */
export const REROUTABLE = ["PENDING", "SENDING"] as const;

/**
 * Libera os jobs presos a um chip que saiu de operação (ban/queda fatal):
 * volta a PENDING, zera chip e lease. Outro chip vivo reprocessa. Retorna a
 * contagem reroteada.
 */
export async function rerouteJobsFromNumber(numberId: string, now: Date): Promise<number> {
  const { count } = await prisma.outboundJob.updateMany({
    where: { whatsAppNumberId: numberId, status: { in: [...REROUTABLE] } },
    data: { status: "PENDING", whatsAppNumberId: null, claimedAt: null, scheduledFor: now },
  });
  return count;
}
```

**Step 2: Chamar no handler de ban**

Em `pool.ts`, dentro do `if (action === "BANNED")`, após marcar o número BANNED:

```typescript
      if (action === "BANNED") {
        await prisma.whatsAppNumber.update({
          where: { id: numberId },
          data: { status: "BANNED", bannedAt: new Date(), lastError: `code=${code}` },
        });
        const { rerouteJobsFromNumber } = await import("@/server/worker/reroute");
        const moved = await rerouteJobsFromNumber(numberId, new Date());
        console.error(`[baileys] "${rec.label}" BANIDO (code=${code}) — ${moved} jobs reroteados.`);
      }
```

**Step 3: Verificar build**

Run: `npm test`
Expected: PASS (sem regressões).

**Step 4: Commit**

```bash
git add src/server/worker/reroute.ts src/server/whatsapp/baileys/pool.ts
git commit -m "feat(durabilidade): reroteia jobs de chip banido p/ chips vivos"
```

---

## Task 7: Cap diário **por conta** (não global)

Hoje `sentToday()` conta TODAS as contas e o worker para o sistema inteiro ao bater `WHATSAPP_DAILY_CAP` ([dispatcher.ts:7-13](../../src/server/worker/dispatcher.ts#L7-L13), [run.ts:49](../../src/server/worker/run.ts#L49)). Para disparo em massa multi-tenant, o cap precisa ser por conta e **opcional (0 = ilimitado)**.

**Files:**
- Modify: `src/server/worker/dispatcher.ts`
- Modify: `src/lib/env.ts`
- Test: `src/server/worker/dispatcher.cap.test.ts` (adicionar caso)

**Step 1: Função de contagem por conta**

Em `dispatcher.ts`:

```typescript
/** Quantos jobs uma CONTA já enviou hoje (cap diário por conta). */
export async function sentTodayByUser(userId: string, now: Date): Promise<number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return prisma.outboundJob.count({
    where: { status: "SENT", sentAt: { gte: start }, lead: { is: { userId } } },
  });
}

/** Decide se a conta pode enviar agora. cap<=0 = ilimitado (modo massa). */
export function underAccountCap(sentToday: number, cap: number): boolean {
  return cap <= 0 || sentToday < cap;
}
```

**Step 2: Teste da decisão pura**

Adicionar em `dispatcher.cap.test.ts`:

```typescript
import { underAccountCap } from "./dispatcher";

describe("underAccountCap", () => {
  it("cap 0 = ilimitado (modo massa)", () => {
    expect(underAccountCap(999_999, 0)).toBe(true);
  });
  it("respeita o teto quando positivo", () => {
    expect(underAccountCap(999, 1000)).toBe(true);
    expect(underAccountCap(1000, 1000)).toBe(false);
  });
});
```

**Step 3: Rodar e ver falhar/passar**

Run: `npm test -- src/server/worker/dispatcher.cap.test.ts`
Expected: depois de implementar, PASS.

**Step 4: Mudar o env default para massa**

Em `env.ts`: `WHATSAPP_DAILY_CAP: z.coerce.number().int().nonnegative().default(0), // 0 = ilimitado (modo massa)`.
(Trocar `.positive()` por `.nonnegative()` p/ aceitar 0.) Remover o gate global de `run.ts:49` (o cap passa a ser checado por conta no momento do claim — Fase 2). Por ora, em `run.ts`, trocar o gate global para não barrar tudo:

```typescript
    // (gate global removido — cap agora é por conta, aplicado no claim)
```

**Step 5: Commit**

```bash
git add src/server/worker/dispatcher.ts src/server/worker/dispatcher.cap.test.ts src/lib/env.ts src/server/worker/run.ts
git commit -m "feat(massa): cap diário por conta e opcional (0=ilimitado); remove trava global"
```

---

**✅ Marco Fase 1:** nenhum job se perde (reaper), chip banido não trava a fila (reroteamento), falta de chip pausa+avisa em vez de livelock, e um tenant não trava os outros. Já dá para rodar 5.000 com segurança — só falta velocidade.

---

# FASE 2 — Vazão (loops paralelos por chip + pacing agressivo)

## Task 8: `claimNextJobForAccount` (claim atômico por conta)

A base do paralelismo: cada chip puxa o próximo job **da sua conta** e o trava, sem que dois chips peguem o mesmo (lock otimista já garante isso).

**Files:**
- Modify: `src/server/worker/dispatcher.ts`

**Step 1: Implementar**

```typescript
/**
 * Reserva atomicamente 1 job PENDING da CONTA (lead.userId), respeitando
 * pausa/cap de campanha e janela. Retorna o id travado (SENDING) ou null.
 * Reusa cappedCampaignIds. Pensado p/ ser chamado por VÁRIOS chips em paralelo.
 */
export async function claimNextJobForAccount(userId: string, now: Date): Promise<string | null> {
  const [capCampaigns, sentByCampaign] = await Promise.all([
    prisma.campaign.findMany({ where: { userId, dailyCap: { not: null } }, select: { id: true, dailyCap: true } }),
    sentTodayByCampaign(now),
  ]);
  const capped = cappedCampaignIds(capCampaigns, sentByCampaign);

  const candidate = await prisma.outboundJob.findFirst({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      lead: { is: { userId } },
      OR: [
        { campaignId: null },
        { campaign: { status: { not: "PAUSED" } }, ...(capped.length ? { campaignId: { notIn: capped } } : {}) },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claim = await prisma.outboundJob.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "SENDING", attempts: { increment: 1 }, claimedAt: now },
  });
  return claim.count === 1 ? candidate.id : null;
}
```

**Step 2: Build**

Run: `npm test`
Expected: PASS.

**Step 3: Commit**

```bash
git add src/server/worker/dispatcher.ts
git commit -m "feat(massa): claimNextJobForAccount p/ claim concorrente por chip"
```

---

## Task 9: Pacing agressivo configurável (função pura)

**Files:**
- Modify: `src/lib/env.ts`
- Create: `src/server/worker/pacing.ts`
- Test: `src/server/worker/pacing.test.ts`

**Step 1: Env do modo massa**

Em `env.ts`:

```typescript
  // Modo massa (risco assumido): ritmo por chip. min<=0 dispara sem pausa.
  MASS_PER_CHIP_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(1500),
  MASS_PER_CHIP_JITTER_MS: z.coerce.number().int().nonnegative().default(1500),
```

**Step 2: Teste**

```typescript
// src/server/worker/pacing.test.ts
import { describe, it, expect } from "vitest";
import { perChipDelayMs } from "./pacing";

describe("perChipDelayMs", () => {
  it("soma intervalo base + jitter determinístico (rand injetável)", () => {
    expect(perChipDelayMs(1500, 1000, () => 0)).toBe(1500);
    expect(perChipDelayMs(1500, 1000, () => 1)).toBe(2500);
  });
  it("intervalo 0 + jitter 0 = sem pausa (máximo)", () => {
    expect(perChipDelayMs(0, 0, () => 0.7)).toBe(0);
  });
});
```

**Step 3: Rodar e ver falhar**

Run: `npm test -- src/server/worker/pacing.test.ts`
Expected: FAIL.

**Step 4: Implementar**

```typescript
// src/server/worker/pacing.ts
/** Pausa por chip entre envios: base + jitter aleatório. rand injetável p/ teste. */
export function perChipDelayMs(minMs: number, jitterMs: number, rand: () => number = Math.random): number {
  return Math.max(0, minMs) + Math.round(Math.max(0, jitterMs) * rand());
}
```

**Step 5: Passar**

Run: `npm test -- src/server/worker/pacing.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add src/server/worker/pacing.ts src/server/worker/pacing.test.ts src/lib/env.ts
git commit -m "feat(massa): perChipDelayMs — pacing agressivo configurável por chip"
```

---

## Task 10: Runner por chip + supervisor (o motor paralelo)

Substitui o loop serial. Para cada chip CONNECTED/WARMING, sobe um laço independente: claim job da conta do chip → envia por aquele chip → pace → repete. O supervisor reconcilia (sobe runner p/ chip novo, derruba p/ chip banido) a cada ciclo.

**Files:**
- Create: `src/server/worker/chipRunner.ts`
- Modify: `src/server/worker/run.ts`

**Step 1: Runner de um chip**

```typescript
// src/server/worker/chipRunner.ts
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { hourInTz, isWithinWindow } from "@/lib/sendWindow";
import { sleep } from "@/lib/humanize";
import { dispatchOutboundJob } from "@/server/services/messaging";
import { claimNextJobForAccount, sentTodayByUser, underAccountCap } from "./dispatcher";
import { perChipDelayMs } from "./pacing";

/**
 * Laço de envio de UM chip. Roda até `signal.stopped` virar true (chip banido/
 * removido). Cada iteração: respeita janela + cap por conta, trava 1 job da conta
 * dona do chip, envia por este chip, e pausa o pacing agressivo.
 */
export async function runChip(
  chip: { id: string; userId: string },
  signal: { stopped: boolean },
): Promise<void> {
  while (!signal.stopped) {
    const now = new Date();
    const hour = hourInTz(now, env.SCHEDULING_TIMEZONE);
    if (!isWithinWindow(hour, { startHour: env.WHATSAPP_SEND_START_HOUR, endHour: env.WHATSAPP_SEND_END_HOUR })) {
      await sleep(60_000);
      continue;
    }
    if (!underAccountCap(await sentTodayByUser(chip.userId, now), env.WHATSAPP_DAILY_CAP)) {
      await sleep(60_000);
      continue;
    }
    // o chip ainda está saudável?
    const fresh = await prisma.whatsAppNumber.findUnique({ where: { id: chip.id }, select: { status: true } });
    if (!fresh || !["CONNECTED", "WARMING"].includes(fresh.status)) { signal.stopped = true; break; }

    const jobId = await claimNextJobForAccount(chip.userId, now);
    if (!jobId) { await sleep(env.WORKER_POLL_MS); continue; }

    try {
      await dispatchOutboundJob(jobId, { numberId: chip.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const job = await prisma.outboundJob.findUnique({ where: { id: jobId }, select: { attempts: true } });
      const failed = (job?.attempts ?? 99) >= 3;
      await prisma.outboundJob.update({
        where: { id: jobId },
        data: failed
          ? { status: "FAILED", lastError: msg, claimedAt: null }
          : { status: "PENDING", lastError: msg, claimedAt: null, whatsAppNumberId: null,
              scheduledFor: new Date(Date.now() + 60_000) },
      });
    }
    await sleep(perChipDelayMs(env.MASS_PER_CHIP_MIN_INTERVAL_MS, env.MASS_PER_CHIP_JITTER_MS));
  }
}
```

**Step 2: Supervisor no worker**

Reescrever o `while (true)` de `run.ts` para reconciliar runners por chip:

```typescript
import { runChip } from "./chipRunner";
// ...
  const runners = new Map<string, { stopped: boolean }>();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (env.WHATSAPP_MODE === "baileys" && pool) await pool.ensureConnections();

    // reaper periódico (Task 4) permanece aqui

    // reconcilia: 1 runner por chip enviável
    const chips = await prisma.whatsAppNumber.findMany({
      where: { status: { in: ["CONNECTED", "WARMING"] } },
      select: { id: true, userId: true },
    });
    const live = new Set(chips.map((c) => c.id));
    // sobe runners novos
    for (const c of chips) {
      if (!runners.has(c.id)) {
        const sig = { stopped: false };
        runners.set(c.id, sig);
        void runChip(c, sig).finally(() => runners.delete(c.id));
      }
    }
    // sinaliza parada p/ chips que saíram (banido/pausado)
    for (const [id, sig] of runners) if (!live.has(id)) sig.stopped = true;

    await sleep(env.WORKER_POLL_MS);
  }
```

Remover o `processNextJob(now)` serial do loop (substituído pelos runners). Manter `processNextJob` exportado p/ o cron mock/cloud-api e testes.

**Step 3: Smoke manual**

Run: `npm run worker` (banco de dev com ≥2 chips conectados e jobs PENDING)
Expected: logs de envio intercalados entre chips; `groupBy sentTodayByNumber` mostra carga distribuída. Encerrar com Ctrl+C.

**Step 4: Commit**

```bash
git add src/server/worker/chipRunner.ts src/server/worker/run.ts
git commit -m "feat(massa): worker com loop de envio paralelo por chip (supervisor)"
```

---

## Task 11: Soltar caps de chip p/ modo massa

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `prisma/seed.ts` (default de novos chips) — opcional
- Doc: `.env.example`

**Step 1: Default de cap por chip alto/ilimitado**

`selectNumber`/`sentTodayByNumber` ainda aplicam cap por chip via `WhatsAppNumber.dailyCap`. No modo massa, criar chips com `dailyCap` alto (ex.: 100000) é o equivalente a "ilimitado". Documentar em `.env.example` e ajustar o default de criação de número (onde o chip é criado em `numbers.service.ts`) para um valor de massa configurável:

Em `env.ts`: `BAILEYS_PER_NUMBER_DAILY_CAP: z.coerce.number().int().positive().default(100000),`

> Mantemos o campo (warm-up continua possível baixando o valor por chip na UI), só mudamos o **default** para não estrangular.

**Step 2: Atualizar `.env.example`** com bloco "Modo massa (risco assumido)" documentando `WHATSAPP_DAILY_CAP=0`, `MASS_PER_CHIP_MIN_INTERVAL_MS`, `MASS_PER_CHIP_JITTER_MS`, `BAILEYS_PER_NUMBER_DAILY_CAP` alto.

**Step 3: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(massa): defaults de cap por chip soltos + doc do modo massa"
```

---

**✅ Marco Fase 2:** N chips enviam em paralelo, pacing agressivo, sem teto artificial. 5.000 leads esvaziam em minutos enquanto houver chip vivo; o que sobra fica durável e retoma (Fase 1).

---

# FASE 3 — Operação (enxergar e controlar)

## Task 12: `listCampaigns` com `_count` (corrige O(n) de memória)

Hoje carrega TODOS os leads e jobs na memória ([campaign.service.ts:26-48](../../src/server/services/campaign.service.ts#L26-L48)) — derruba a tela em 5.000+.

**Files:**
- Modify: `src/server/services/campaign.service.ts:22-52`

**Step 1: Trocar include por groupBy/_count**

Substituir o `findMany({ include: { leads, outboundJobs } })` por contagens agregadas:

```typescript
export async function listCampaigns(userId: string): Promise<CampaignListItem[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { userId }, orderBy: { createdAt: "desc" },
    select: { id: true, name: true, messageTemplate: true, status: true, dailyCap: true, createdAt: true },
  });
  const ids = campaigns.map((c) => c.id);
  const [leadCounts, novoCounts, jobCounts] = await Promise.all([
    prisma.lead.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids }, status: "NOVO" }, _count: { _all: true } }),
    prisma.outboundJob.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: ids } }, _count: { _all: true } }),
  ]);
  // montar os mapas e o retorno (mesma shape de CampaignListItem) ...
}
```

(Montar helpers de lookup por `campaignId`; `pending` = soma de PENDING+SENDING; `sent` = SENT; `failed` = FAILED.)

**Step 2: Verificar a página de Campanhas**

Run: `npm run dev` → abrir `/campaigns` com uma campanha de muitos leads.
Expected: carrega rápido, contagens corretas, sem puxar linhas individuais.

**Step 3: Commit**

```bash
git add src/server/services/campaign.service.ts
git commit -m "perf(massa): listCampaigns via _count/groupBy (remove carga O(n))"
```

---

## Task 13: Endpoint de progresso/ETA da fila

**Files:**
- Create: `src/app/api/campaigns/[id]/progress/route.ts`
- Create: `src/server/services/dispatchMetrics.ts`
- Test: `src/server/services/dispatchMetrics.test.ts` (função pura de ETA)

**Step 1: Teste da ETA pura**

```typescript
// src/server/services/dispatchMetrics.test.ts
import { describe, it, expect } from "vitest";
import { estimateEtaMinutes } from "./dispatchMetrics";

describe("estimateEtaMinutes", () => {
  it("fila / vazão por minuto", () => {
    expect(estimateEtaMinutes(1000, 100)).toBe(10);
  });
  it("vazão 0 = null (sem chip vivo)", () => {
    expect(estimateEtaMinutes(1000, 0)).toBeNull();
  });
});
```

**Step 2: Implementar métricas + ETA**

```typescript
// src/server/services/dispatchMetrics.ts
export function estimateEtaMinutes(pending: number, sentPerMinute: number): number | null {
  if (sentPerMinute <= 0) return null;
  return Math.ceil(pending / sentPerMinute);
}
```

Mais a função de query `getCampaignProgress(campaignId)`: conta PENDING/SENDING/SENT/FAILED, conta chips vivos, calcula `sentPerMinute` (SENT na última hora / 60), e devolve `etaMinutes`.

**Step 3: Rota**

GET que retorna `{ pending, sent, failed, liveChips, sentPerMinute, etaMinutes }`. A UI de campanha consome p/ mostrar "Enviados X/Y · ETA ~Z min · N chips vivos".

**Step 4: Rodar testes + commit**

Run: `npm test -- src/server/services/dispatchMetrics.test.ts`
Expected: PASS.

```bash
git add src/app/api/campaigns/ src/server/services/dispatchMetrics.ts src/server/services/dispatchMetrics.test.ts
git commit -m "feat(massa): progresso/ETA da fila por campanha"
```

---

## Task 14: Heartbeat do worker + alerta de chips esgotados

**Files:**
- Modify: `src/server/worker/run.ts` (gravar heartbeat)
- Create: `src/app/api/health/worker/route.ts`
- (Opcional) Modify: campanha PAUSED por "sem chip" já sinaliza via `lastError` (Task 5)

**Step 1: Heartbeat**

No loop do worker, a cada ciclo, `UPSERT` de um registro simples (tabela `WorkerHeartbeat { id, beatAt }` ou reusar uma linha de config). Rota `/api/health/worker` compara `now - beatAt`: se > N min → 503 "worker offline".

**Step 2: Alerta de todos os chips banidos**

Quando o supervisor (Task 10) detectar `chips.length === 0` mas houver jobs PENDING, logar/emitir alerta (e-mail via `lib/email.ts` ou Sentry via `SENTRY_DSN`) "0 chips vivos com fila pendente — repor números".

**Step 3: Commit**

```bash
git add src/server/worker/run.ts src/app/api/health/
git commit -m "feat(massa): heartbeat do worker + alerta de chips esgotados"
```

---

**✅ Marco Fase 3:** operador vê fila/ETA/chips vivos, é avisado quando o worker cai ou os chips esgotam, e a tela de campanhas aguenta volume.

---

## Resumo de verificação final

1. `npm test` — toda a suíte verde.
2. Smoke do worker com 2+ chips e ~50 jobs: envio paralelo, distribuição entre chips, pacing agressivo.
3. Matar o worker no meio de um envio → reiniciar → reaper recupera os `SENDING` órfãos (nenhum job perdido).
4. Banir um chip (ou forçar status BANNED) → jobs reroteiam p/ chip vivo.
5. Derrubar todos os chips → campanha pausa com `lastError` claro; reconectar um chip e despausar → fila retoma de onde parou.
6. `/campaigns` carrega rápido com campanha de milhares de leads; `/api/campaigns/[id]/progress` mostra ETA coerente.

## Notas de risco / fora de escopo

- **Sharding multi-worker (dezenas+ de chips):** fora de escopo (decisão: 2–10 chips). Se crescer, adicionar lease de chip por worker na tabela `WhatsAppNumber` antes de subir um 2º processo — dois processos no mesmo número = sessão WhatsApp derrubada.
- **Ban é esperado no modo massa:** a garantia entregue é *durabilidade + retomada*, não vazão infinita. Sem chip vivo, a fila espera (não falha).
- **`prisma db push`:** o repo não versiona migrations; em produção (Railway) o `db push` roda no deploy. Validar as novas colunas (`claimedAt`, `deferCount`) num banco de staging antes do deploy de produção.
