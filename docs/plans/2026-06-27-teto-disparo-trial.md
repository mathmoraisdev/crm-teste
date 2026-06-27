# Teto de Disparo no Trial (cap diário menor para não-pagantes) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Conter o custo do disparo em massa durante o teste grátis. Hoje uma conta em
trial dispara igual a um cliente pago (mesmo `WHATSAPP_DAILY_CAP`, único e global). Vamos
aplicar um **cap diário menor** (~30/dia) para contas **sem pagamento lançado** (trial e
cortesia), mantendo o cap normal para quem já tem pagamento registrado.

**Decisões já tomadas (com o dono do produto):**
- **Formato:** cap **diário menor** para trial (não teto total) — reusa a maquinaria
  existente (`sentTodayByUser` + `underAccountCap`), mudança mínima.
- **Tamanho:** **~30/dia** (env `TRIAL_WHATSAPP_DAILY_CAP=30`, ajustável).
- **Quem escapa:** **só quem tem pagamento lançado** (`paymentDueDate != null`). Conta
  `AUTO` em trial **e** conta `ACTIVE` de cortesia (forçada ativa sem pagamento)
  continuam sob o teto de trial. Discriminador: `paymentDueDate == null` → teto de trial.

**Architecture:**
- **Discriminador reusa campo existente.** Não há flag de "trial" no schema — trial e pago
  são ambos `billingOverride: AUTO` + `accessUntil` futuro. O único sinal de "já paga" é
  `paymentDueDate` (preenchido no `setInfo` do [account.service.ts](../../src/server/services/account.service.ts)).
  Logo `paymentDueDate == null` = não-pagante = teto de trial. **Zero mudança de schema.**
- **Dois pontos de envio, dois modos:**
  - **Baileys (produção, primário):** o cap por conta já existe em
    [chipRunner.ts:25](../../src/server/worker/chipRunner.ts) via
    `underAccountCap(sentTodayByUser(...), env.WHATSAPP_DAILY_CAP)`. Trocamos o cap fixo por
    um **cap efetivo** que depende do status de pagamento da conta. **Esta é a Phase 1 (core).**
  - **Cloud API (fallback):** [processNextJob](../../src/server/worker/dispatcher.ts) **não
    tem cap por conta nenhum** — está aberto. **Phase 2** fecha esse furo (relevante só quando
    `WHATSAPP_MODE != baileys`).
- **Função pura no centro.** `effectiveDailyCap(hasPayment, normalCap, trialCap)` decide o
  teto num lugar só, testável isolada. Convenção `0 = ilimitado` preservada
  (`underAccountCap(_, 0) = true`); `trialCap <= 0` **desliga** o teto de trial (cai no normal).
- **Sem novo gate de UX obrigatório.** Estourar o teto **não** vira erro: o job fica
  `PENDING` e flui no dia seguinte (cap diário) ou quando vira pagante — mesma forma da
  suspensão. Surfacing opcional na UI fica na Phase 3.

**Tech Stack:** Next.js (App Router), Prisma + PostgreSQL (`db push`, não `migrate`),
Baileys worker, Vitest (`vi.mock` do prisma), TypeScript. Env validado em
[src/lib/env.ts](../../src/lib/env.ts) (zod). Commits pt-BR no estilo do repo
(`feat(financeiro): ...`).

---

## Convenções deste repositório (leia antes de começar)

- **Migrations:** este plano **não mexe no schema** (reusa `paymentDueDate`). Sem `db push`.
- **Testes:** Vitest, alias `@/`. Padrão `vi.mock("@/server/db/client", ...)`. Modelo de
  teste puro em [dispatcher.cap.test.ts](../../src/server/worker/dispatcher.cap.test.ts).
- **Rodar um teste:** `npx vitest run <caminho> -t "<nome>"`.
- **Env:** numéricos com `z.coerce.number()` — ver `WHATSAPP_DAILY_CAP`
  ([env.ts:36](../../src/lib/env.ts)). Documentar no [.env.example](../../.env.example).
- **Onde a env é lida:** `chipRunner`/`dispatcher` rodam **no WORKER**. A env nova
  (`TRIAL_WHATSAPP_DAILY_CAP`) tem de ir no serviço **worker (`crm-teste`)** — diferente do
  `TRIAL_DAYS`, que é só web (`sparkling-harmony`).
- **Commits:** um por tarefa.

---

## Mapa de impacto

| Arquivo | Uso | Mudança |
|---|---|---|
| `src/lib/env.ts` | env | + `TRIAL_WHATSAPP_DAILY_CAP` (default 30) |
| `.env.example` | doc | documenta a env nova |
| `src/server/worker/dispatcher.ts` | helpers | + `effectiveDailyCap` (puro) + `accountDailyCap(userId)` |
| `src/server/worker/dispatcher.cap.test.ts` | teste | + casos de `effectiveDailyCap` |
| `src/server/worker/chipRunner.ts` | gate Baileys | usa `accountDailyCap` no lugar do cap fixo |
| `src/server/worker/dispatcher.ts` (`processNextJob`) | gate Cloud API | reprograma job de conta no teto p/ o dia seguinte (Phase 2) |
| Railway worker `crm-teste` | env | `TRIAL_WHATSAPP_DAILY_CAP=30` |

---

## Phase 0 — Função pura + env

### Task 0.1: `effectiveDailyCap` (o coração, testado isolado)

**Files:**
- Modify: `src/server/worker/dispatcher.ts` (adicionar perto de `underAccountCap`, ~linha 42)
- Modify: `src/server/worker/dispatcher.cap.test.ts`

**Step 1: Escrever os testes que falham** (acrescentar ao final do arquivo de teste):

```typescript
import { cappedCampaignIds, underAccountCap, effectiveDailyCap } from "./dispatcher";

describe("effectiveDailyCap", () => {
  it("conta com pagamento lançado usa o cap normal", () => {
    expect(effectiveDailyCap(true, 0, 30)).toBe(0);   // pago em modo massa = ilimitado
    expect(effectiveDailyCap(true, 500, 30)).toBe(500);
  });
  it("conta sem pagamento (trial/cortesia) usa o teto de trial", () => {
    expect(effectiveDailyCap(false, 0, 30)).toBe(30);   // mesmo com normal ilimitado, trial trava em 30
    expect(effectiveDailyCap(false, 500, 30)).toBe(30);
  });
  it("teto de trial <= 0 desliga o recurso (cai no normal)", () => {
    expect(effectiveDailyCap(false, 500, 0)).toBe(500);
    expect(effectiveDailyCap(false, 0, 0)).toBe(0);
  });
});
```

> O caso-chave é `effectiveDailyCap(false, 0, 30) === 30`: hoje `WHATSAPP_DAILY_CAP=0`
> (modo massa = ilimitado), então sem este recurso o trial fica **sem teto**. É exatamente
> o buraco que estamos fechando.

**Step 2: Rodar e ver falhar** — `npx vitest run src/server/worker/dispatcher.cap.test.ts`
Expected: FAIL (`effectiveDailyCap` não existe).

**Step 3: Implementar** (em `dispatcher.ts`, logo após `underAccountCap`):

```typescript
/**
 * Cap diário EFETIVO de uma conta. Conta com pagamento lançado usa o cap normal
 * (`normalCap`, podendo ser 0 = ilimitado/modo massa). Conta sem pagamento (trial
 * ou cortesia) usa o teto de trial (`trialCap`) — mesmo quando o normal é ilimitado.
 * `trialCap <= 0` desliga o recurso (cai no normal). Convenção 0=ilimitado mantida.
 */
export function effectiveDailyCap(hasPayment: boolean, normalCap: number, trialCap: number): number {
  if (hasPayment || trialCap <= 0) return normalCap;
  return trialCap;
}
```

**Step 4: Rodar e ver passar** — `npx vitest run src/server/worker/dispatcher.cap.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/worker/dispatcher.ts src/server/worker/dispatcher.cap.test.ts
git commit -m "feat(financeiro): effectiveDailyCap (teto de trial por conta sem pagamento)"
```

### Task 0.2: env `TRIAL_WHATSAPP_DAILY_CAP`

**Files:**
- Modify: `src/lib/env.ts` (perto de `WHATSAPP_DAILY_CAP`, ~linha 36)
- Modify: `.env.example`

**Step 1:** Adicionar no schema de env:

```typescript
  // Teto diário de disparo para contas SEM pagamento lançado (trial/cortesia).
  // Cap normal segue em WHATSAPP_DAILY_CAP. 0 = desliga (trial usa o cap normal).
  TRIAL_WHATSAPP_DAILY_CAP: z.coerce.number().int().nonnegative().default(30),
```

**Step 2:** Documentar no `.env.example` ao lado de `WHATSAPP_DAILY_CAP`:

```
# Teto diário de disparo no teste grátis (conta sem pagamento lançado). 0 = desliga.
TRIAL_WHATSAPP_DAILY_CAP=30
```

**Step 3: Conferir tipos** — `npx tsc --noEmit` (sem erros).

**Step 4: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(financeiro): env TRIAL_WHATSAPP_DAILY_CAP (default 30)"
```

---

## Phase 1 — Gate Baileys (produção, core)

### Task 1.1: `accountDailyCap(userId)` no dispatcher

**Files:**
- Modify: `src/server/worker/dispatcher.ts`

**Step 1: Implementar** (após `effectiveDailyCap`; `prisma` e `env` já estão importados):

```typescript
/**
 * Cap diário efetivo da conta lendo o banco: sem `paymentDueDate` (trial/cortesia)
 * → teto de trial; com pagamento → cap normal. Conta inexistente: trata como
 * não-pagante (fail-safe conservador = aplica o teto menor).
 */
export async function accountDailyCap(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { paymentDueDate: true },
  });
  return effectiveDailyCap(
    user?.paymentDueDate != null,
    env.WHATSAPP_DAILY_CAP,
    env.TRIAL_WHATSAPP_DAILY_CAP,
  );
}
```

**Step 2: Conferir tipos** — `npx tsc --noEmit`.

**Step 3: Commit**

```bash
git add src/server/worker/dispatcher.ts
git commit -m "feat(financeiro): accountDailyCap lê pagamento e devolve cap efetivo"
```

### Task 1.2: `chipRunner` usa o cap efetivo

**Files:**
- Modify: `src/server/worker/chipRunner.ts`

**Step 1:** No import da linha 6, acrescentar `accountDailyCap`:

```typescript
import { claimNextJobForAccount, sentTodayByUser, underAccountCap, accountDailyCap } from "./dispatcher";
```

**Step 2:** Trocar o bloco do cap (linhas 25-28):

```typescript
    if (!underAccountCap(await sentTodayByUser(chip.userId, now), env.WHATSAPP_DAILY_CAP)) {
      await sleep(60_000);
      continue;
    }
```

por:

```typescript
    // Cap por conta: trial/cortesia (sem pagamento lançado) usa teto menor.
    const cap = await accountDailyCap(chip.userId);
    if (!underAccountCap(await sentTodayByUser(chip.userId, now), cap)) {
      await sleep(60_000);
      continue;
    }
```

**Step 3: Conferir tipos** — `npx tsc --noEmit`. (Suite: `npx vitest run` continua verde —
`chipRunner` não tem teste unitário; a lógica testável está nas funções puras.)

**Step 4: Commit**

```bash
git add src/server/worker/chipRunner.ts
git commit -m "feat(financeiro): chipRunner aplica teto de trial no disparo Baileys"
```

> Efeito: conta em trial para de disparar ao atingir ~30 envios no dia; o chip dorme 60s e
> os jobs restantes ficam `PENDING`, retomando no dia seguinte (ou imediatamente ao virar
> pagante). Cliente pago segue no `WHATSAPP_DAILY_CAP`.

---

## Phase 2 — Gate Cloud API (fecha o furo do fallback)

> Só relevante quando `WHATSAPP_MODE != "baileys"`. Em produção (Baileys) a Phase 1 já cobre.
> `processNextJob` seleciona qualquer job entre contas e **não** tem cap por conta hoje.

### Task 2.1: reprogramar job de conta no teto para o dia seguinte

**Files:**
- Modify: `src/server/worker/dispatcher.ts` (`processNextJob`)

**Step 1:** Logo após o claim bem-sucedido (após `if (claim.count === 0) return false;`,
~linha 197) e **antes** do bloco Baileys, inserir a checagem do cap por conta. Como
`processNextJob` é o caminho não-Baileys, este gate vale para o envio direto (Cloud API):

```typescript
  // Cap por conta (trial/cortesia): se a conta dona do job já bateu o teto efetivo
  // hoje, devolve o job p/ amanhã (sem contar tentativa) e segue. Mantém o custo
  // do fallback Cloud API sob controle no teste grátis.
  const userId = candidate.lead.userId;
  const cap = await accountDailyCap(userId);
  if (!underAccountCap(await sentTodayByUser(userId, now), cap)) {
    const tomorrow = new Date(now);
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    await prisma.outboundJob.update({
      where: { id: candidate.id },
      data: { status: "PENDING", attempts: { decrement: 1 }, claimedAt: null, scheduledFor: tomorrow },
    });
    return false;
  }
```

> Reprogramar p/ o início do dia seguinte (em vez de só `return`) evita o `findFirst`
> reescolher o mesmo job em loop — ele sai da janela `scheduledFor <= now` de hoje. Mesmo
> espírito do defer de "sem chip", mas em escala diária. `sentTodayByUser`/`underAccountCap`/
> `accountDailyCap` já existem; só precisam estar importados no escopo (mesmo arquivo).

**Step 2: Conferir tipos** — `npx tsc --noEmit`.

**Step 3 (opcional): teste de fumaça** do caminho puro já coberto na Phase 0; o
reschedule é I/O. Se quiser cobrir, extrair `nextDayStart(now)` como função pura e testá-la.

**Step 4: Commit**

```bash
git add src/server/worker/dispatcher.ts
git commit -m "feat(financeiro): processNextJob respeita teto de trial (caminho Cloud API)"
```

---

## Phase 3 — Surfacing na UI (opcional, melhora conversão)

> Não é obrigatório para conter custo (o worker já trava). Serve para o cliente entender
> "estou no teste, com X/dia" e converter. Avaliar depois.

Ideias (escolher 1, leve):
- **Banner no /campaigns** quando a conta é trial (sem pagamento): "Modo teste: até N
  mensagens/dia até a ativação." `N` = `TRIAL_WHATSAPP_DAILY_CAP`. A página já é server
  component; dá pra ler `paymentDueDate` da conta logada e a env.
- **Aviso no `startCampaign`** se a campanha tem mais leads que o teto restante hoje:
  retornar um campo informativo no resultado (não bloquear), exibido como toast.

Sem mudança de schema. Implementar só se o produto pedir.

---

## Phase 4 — Env em produção + verificação manual

### Task 4.1: Definir a env no WORKER

- **Local (`.env`):** `TRIAL_WHATSAPP_DAILY_CAP=30` (ou outro valor; `0` desliga).
- **Railway worker `crm-teste` → Variables:** `TRIAL_WHATSAPP_DAILY_CAP=30`.
  ⚠️ É o **worker** que roda `chipRunner`/`dispatcher`. O web (`sparkling-harmony`) **não
  precisa** desta env (só precisaria na Phase 3, se a UI ler a env para o banner).

### Task 4.2: Roteiro de verificação (dev, modo Baileys)

1. **Trial trava no teto:** conta nova (trial, `paymentDueDate=null`) + 1 chip conectado.
   Criar campanha com >30 leads → após ~30 envios no dia o chip para; jobs restantes ficam
   `PENDING`. Confirmar no banco: `outboundJob` SENT do dia = teto; resto PENDING.
2. **Pagamento libera o cap normal:** no `/financeiro`, lançar pagamento (forma + vencimento)
   nessa conta → `paymentDueDate != null` → no próximo poll o disparo retoma sob
   `WHATSAPP_DAILY_CAP` (com 0 = ilimitado, escoa tudo).
3. **Cortesia continua sob o teto:** "Forçar ativo" numa conta **sem** pagamento lançado →
   continua limitada a ~30/dia (decisão "só pago escapa").
4. **Kill switch:** `TRIAL_WHATSAPP_DAILY_CAP=0` no worker → trial volta a usar o cap normal.

### Task 4.3: Suite + build

- `npx vitest run` → tudo verde.
- `npx tsc --noEmit` e `npm run build` → sem erros.

---

## Resumo das mudanças (checklist)

| Camada | Arquivo | Mudança |
|---|---|---|
| Função pura | `src/server/worker/dispatcher.ts` | `effectiveDailyCap` + testes |
| Leitura DB | `src/server/worker/dispatcher.ts` | `accountDailyCap(userId)` |
| Gate Baileys | `src/server/worker/chipRunner.ts` | cap fixo → `accountDailyCap` |
| Gate Cloud API | `src/server/worker/dispatcher.ts` | `processNextJob` reprograma job no teto |
| Env | `src/lib/env.ts` + `.env.example` | `TRIAL_WHATSAPP_DAILY_CAP` (default 30) |
| Deploy | Railway worker `crm-teste` | `TRIAL_WHATSAPP_DAILY_CAP=30` |
| UI (opcional) | `/campaigns` | banner "modo teste: N/dia" |

## Pontos de atenção / decisões

- **Sem mudança de schema** — discriminador é `paymentDueDate == null` (não-pagante).
- **"Só pago escapa"** — cortesia (`ACTIVE` sem pagamento) fica sob o teto de trial.
- **0 = ilimitado** preservado; `TRIAL_WHATSAPP_DAILY_CAP <= 0` desliga o recurso.
- **Caso-chave:** hoje `WHATSAPP_DAILY_CAP=0` (modo massa), então sem este recurso o trial
  está **sem teto**. `effectiveDailyCap(false, 0, 30) = 30` fecha isso.
- **Env vai no WORKER** (`crm-teste`), não no web.
- **Phase 2 só importa no fallback Cloud API**; produção (Baileys) é coberta pela Phase 1.
- **Limitação conhecida:** o teto é **por conta**, contando todos os envios do dia (campanha
  + qualquer outbound). É o comportamento desejado (limita custo total da conta no trial).
