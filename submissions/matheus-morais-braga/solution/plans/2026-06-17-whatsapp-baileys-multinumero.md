# Transporte WhatsApp via Baileys (multi-número) — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` para implementar este plano tarefa-a-tarefa.

**Goal:** Adicionar um transporte WhatsApp **não-oficial via Baileys** atrás da interface `WhatsAppService` existente, com **multi-número + rotação** e uma **camada anti-ban** (warm-up por número, spintax, simulação humana, verificação `onWhatsApp`, detecção de ban), mantendo a **Cloud API como fallback** por `WHATSAPP_MODE` — reutilizando integralmente a fila `OutboundJob`, o worker (rate-limit/jitter/janela/cap) e o opt-out já existentes.

**Architecture:** O socket Baileys é **stateful** e mora num pool dentro do **worker** (processo persistente que já existe), keyed por `WhatsAppNumber`. O Next.js continua só enfileirando. O **inbound** deixa de vir por webhook e passa a ser evento de socket (`messages.upsert`) → mesmo `handleInbound`. O **gate de qualidade da Meta** (que pausava campanhas) é substituído por um **health gate por número**: ao detectar logout/ban no `connection.update`, o número é marcado `BANNED` e sai da rotação — os demais continuam. Toda a lógica pura (rotação, warm-up, spintax, delay humano, classificação de ban) é TDD; a cola de socket é validada por smoke manual (exige chip real).

**Tech Stack:** Next.js 15, Prisma + Postgres, TypeScript, vitest, tsx (worker), `@whiskeysockets/baileys`, `qrcode-terminal`, `pino`.

**Princípios:** DRY, YAGNI, TDD na lógica pura, checkpoints frequentes, **não quebrar `WHATSAPP_MODE=mock` nem `cloud-api`**.

> ⚠️ **Realidade que o código não resolve:** nenhuma estrutura garante 100% contra bloqueio. O que derruba número é comportamento + **taxa de denúncia da lista**. A lista aqui é tratada como **fria no pior caso** → warm-up conservador e expectativa de que chips podem ser perdidos. O código maximiza a sobrevivência; a qualidade do opt-in é responsabilidade operacional.

---

## Convenções deste plano

- **Test runner:** vitest. Um arquivo: `npx vitest run caminho/arquivo.test.ts`. Suíte toda: `npm test`.
- **Prisma:** após editar `schema.prisma`, sempre `npm run db:push && npm run db:generate` antes de usar os modelos novos no TS.
- **Commits = checkpoints.** Cada "Commit" é um ponto de parada/validação.
- **Lógica pura primeiro (TDD):** spintax, delay humano, classificação de ban e seleção de número são funções puras testáveis.
- **Baileys exige chip real** para smoke de conexão (QR). Onde precisar de chip, o passo é marcado `[SMOKE MANUAL]` e a verificação automática é só `tsc`/unit.

---

## Tarefa 0: Setup (branch + dependências)

**Step 1: Branch de trabalho**

Run:
```bash
git checkout -b feat/whatsapp-baileys-multinumero
```
Expected: branch criada a partir de master.

**Step 2: Instalar dependências do Baileys**

Run:
```bash
npm install @whiskeysockets/baileys qrcode-terminal pino
npm install -D @types/qrcode-terminal
```
Expected: pacotes adicionados a `package.json` sem erro de peer-deps fatal.

**Step 3: Ignorar as sessões do Baileys no git**

Acrescente ao `.gitignore`:
```
# Sessões do Baileys (credenciais de número — NUNCA commitar)
.baileys-auth/
```

**Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore(baileys): deps (baileys, qrcode-terminal, pino) + gitignore das sessões"
```

---

## Tarefa 1: Env — modo `baileys` + variáveis da camada

**Files:**
- Modify: `src/lib/env.ts:19` (enum do `WHATSAPP_MODE`) e o bloco de deliverability
- Modify: `.env.example`

**Step 1: Adicionar `baileys` ao enum e as vars novas**

Em `src/lib/env.ts`, troque a linha do modo:
```ts
  WHATSAPP_MODE: z.enum(["mock", "cloud-api", "baileys"]).default("mock"),
```
E, no bloco "Deliverability", acrescente:
```ts
  // Baileys (transporte não-oficial, multi-número)
  BAILEYS_AUTH_DIR: z.string().default(".baileys-auth"),
  BAILEYS_PER_NUMBER_DAILY_CAP: z.coerce.number().int().positive().default(30), // warm-up conservador por chip
  BAILEYS_ONWHATSAPP_CHECK: z.coerce.boolean().default(true), // pula número sem WhatsApp
  BAILEYS_TYPING_MS_PER_CHAR: z.coerce.number().int().nonnegative().default(55), // simula digitação
  BAILEYS_TYPING_MAX_MS: z.coerce.number().int().positive().default(9000), // teto do "digitando..."
```

**Step 2: Documentar no `.env.example`**

Acrescente ao final:
```
# ─────────────────────────────────────────────────────────────
# Baileys — transporte não-oficial multi-número (WHATSAPP_MODE=baileys)
# ─────────────────────────────────────────────────────────────
BAILEYS_AUTH_DIR=".baileys-auth"      # pasta-base das sessões (1 subpasta por número)
BAILEYS_PER_NUMBER_DAILY_CAP="30"     # teto diário POR CHIP no warm-up (suba devagar!)
BAILEYS_ONWHATSAPP_CHECK="true"       # verifica se o número existe no WhatsApp antes de enviar
BAILEYS_TYPING_MS_PER_CHAR="55"       # ms de "digitando" por caractere (simulação humana)
BAILEYS_TYPING_MAX_MS="9000"          # teto do tempo de digitação
```

**Step 3: Validar que o app sobe**

Run: `npx tsx -e "import('./src/lib/env.ts').then(()=>console.log('env ok'))"`
Expected: "env ok".

**Step 4: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(config): modo baileys + env de warm-up por número, onWhatsApp e digitação"
```

---

## Tarefa 2: Schema — modelo `WhatsAppNumber` e rastreio do número usado

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Novo enum de status do número**

Adicione perto dos outros enums:
```prisma
enum WhatsAppNumberStatus {
  CONNECTING    // pareando / subindo socket
  CONNECTED     // saudável, pode enviar
  WARMING       // conectado, mas em warm-up (cap reduzido)
  PAUSED        // pausado manualmente
  BANNED        // logout/403 detectado — fora da rotação
  DISABLED      // desativado pelo operador
}
```

**Step 2: Modelo `WhatsAppNumber`**

Adicione ao final do schema:
```prisma
model WhatsAppNumber {
  id           String               @id @default(cuid())
  label        String               // apelido operacional ("chip-01")
  phone        String               @unique // número do próprio chip, E.164
  sessionDir   String               @unique // subpasta em BAILEYS_AUTH_DIR
  status       WhatsAppNumberStatus @default(CONNECTING)
  dailyCap     Int                  @default(30) // teto/dia deste chip (warm-up)
  lastError    String?
  connectedAt  DateTime?
  bannedAt     DateTime?
  createdAt    DateTime             @default(now())
  updatedAt    DateTime             @updatedAt

  outboundJobs OutboundJob[]
  messages     Message[]
  leads        Lead[]

  @@index([status])
}
```

**Step 3: Rastrear qual número enviou (auditoria + cap por número + roteamento de resposta)**

No `model OutboundJob`, adicione:
```prisma
  whatsAppNumber   WhatsAppNumber? @relation(fields: [whatsAppNumberId], references: [id])
  whatsAppNumberId String?
```
Adicione também o índice para a contagem diária por número:
```prisma
  @@index([whatsAppNumberId, status, sentAt])
```

No `model Message`, adicione (qual chip enviou/recebeu — auditoria):
```prisma
  whatsAppNumber   WhatsAppNumber? @relation(fields: [whatsAppNumberId], references: [id])
  whatsAppNumberId String?
```

No `model Lead`, adicione (o chip "dono" da conversa, p/ responder pelo mesmo número):
```prisma
  whatsAppNumber   WhatsAppNumber? @relation(fields: [whatsAppNumberId], references: [id])
  whatsAppNumberId String?
```

**Step 4: Aplicar e regenerar**

Run:
```bash
npm run db:push && npm run db:generate
```
Expected: "Your database is now in sync" e client regenerado sem erro.

**Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(db): modelo WhatsAppNumber + rastreio do número em job/mensagem/lead"
```

---

## Tarefa 3: Spintax — variação de conteúdo (lógica pura, TDD)

> Defesa anti-ban: texto idêntico em massa é o sinal de spam nº 1. `{oi|olá|e aí}` vira uma opção sorteada por lead.

**Files:**
- Create: `src/lib/spintax.ts`
- Test: `src/lib/spintax.test.ts`

**Step 1: Teste que falha**

`src/lib/spintax.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderSpintax } from "./spintax";

describe("renderSpintax", () => {
  // pick determinístico: sempre a 1ª opção
  const first = (n: number) => 0;
  const last = (n: number) => n - 1;

  it("escolhe a opção indicada por `pick` em cada grupo", () => {
    expect(renderSpintax("{oi|olá|e aí} tudo bem?", first)).toBe("oi tudo bem?");
    expect(renderSpintax("{oi|olá|e aí} tudo bem?", last)).toBe("e aí tudo bem?");
  });

  it("resolve múltiplos grupos e mantém o texto fora deles", () => {
    expect(renderSpintax("{bom dia|olá} {nome}, {pode falar|tem um minuto}?", first))
      .toBe("bom dia {nome}, pode falar?");
  });

  it("texto sem spintax volta inalterado", () => {
    expect(renderSpintax("mensagem simples", first)).toBe("mensagem simples");
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/spintax.test.ts`
Expected: FAIL — "renderSpintax is not a function".

**Step 3: Implementar o mínimo**

`src/lib/spintax.ts`:
```ts
/**
 * Spintax: `{a|b|c}` → uma das opções. `pick(n)` recebe o nº de opções e
 * devolve o índice escolhido (injetável p/ testar; no uso real é aleatório).
 * Não aninha grupos (YAGNI) — resolve da esquerda p/ direita.
 */
export function renderSpintax(
  text: string,
  pick: (count: number) => number = (n) => Math.floor(Math.random() * n),
): string {
  return text.replace(/\{([^{}]+)\}/g, (_, group: string) => {
    const opts = group.split("|");
    const i = Math.max(0, Math.min(opts.length - 1, pick(opts.length)));
    return opts[i];
  });
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/spintax.test.ts`
Expected: PASS (3 testes).

**Step 5: Commit**

```bash
git add src/lib/spintax.ts src/lib/spintax.test.ts
git commit -m "feat(deliverability): spintax p/ variação de mensagem (anti-spam)"
```

---

## Tarefa 4: Delay humano de digitação (lógica pura, TDD)

**Files:**
- Create: `src/lib/humanize.ts`
- Test: `src/lib/humanize.test.ts`

**Step 1: Teste que falha**

`src/lib/humanize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { typingDelayMs } from "./humanize";

describe("typingDelayMs", () => {
  const opts = { msPerChar: 50, maxMs: 9000 };
  it("cresce com o tamanho do texto", () => {
    // jitter fixo em 0 p/ determinismo
    expect(typingDelayMs(10, opts, () => 0)).toBe(500);
    expect(typingDelayMs(40, opts, () => 0)).toBe(2000);
  });
  it("respeita o teto", () => {
    expect(typingDelayMs(1000, opts, () => 0)).toBe(9000);
  });
  it("soma jitter aleatório", () => {
    // rand=1 → soma o máximo de jitter (até 30% do base)
    expect(typingDelayMs(10, opts, () => 1)).toBe(650); // 500 + 30%
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/humanize.test.ts`
Expected: FAIL.

**Step 3: Implementar o mínimo**

`src/lib/humanize.ts`:
```ts
export interface TypingOpts {
  msPerChar: number;
  maxMs: number;
}

/**
 * Quanto tempo "digitar" antes de enviar — proporcional ao texto, com teto e
 * jitter. `rand` é injetável p/ teste (no uso real, Math.random).
 */
export function typingDelayMs(
  textLength: number,
  opts: TypingOpts,
  rand: () => number = Math.random,
): number {
  const base = Math.min(textLength * opts.msPerChar, opts.maxMs);
  const jitter = Math.round(base * 0.3 * rand());
  return base + jitter;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/humanize.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/humanize.ts src/lib/humanize.test.ts
git commit -m "feat(deliverability): delay de digitação humano (proporcional + jitter)"
```

---

## Tarefa 5: Classificação de desconexão / ban (lógica pura, TDD)

> Substitui o quality-gate da Meta: traduz o `DisconnectReason` do Baileys numa ação operacional.

**Files:**
- Create: `src/server/whatsapp/baileys/bansignals.ts`
- Test: `src/server/whatsapp/baileys/bansignals.test.ts`

**Step 1: Teste que falha**

`src/server/whatsapp/baileys/bansignals.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { classifyDisconnect } from "./bansignals";

describe("classifyDisconnect", () => {
  it("401 (loggedOut) e 403 (forbidden) → BANNED", () => {
    expect(classifyDisconnect(401)).toBe("BANNED");
    expect(classifyDisconnect(403)).toBe("BANNED");
  });
  it("440 (connectionReplaced) → FATAL (outra sessão assumiu)", () => {
    expect(classifyDisconnect(440)).toBe("FATAL");
  });
  it("515 (restartRequired) e quedas transitórias → RECONNECT", () => {
    expect(classifyDisconnect(515)).toBe("RECONNECT");
    expect(classifyDisconnect(428)).toBe("RECONNECT"); // connectionClosed
    expect(classifyDisconnect(undefined)).toBe("RECONNECT");
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/whatsapp/baileys/bansignals.test.ts`
Expected: FAIL.

**Step 3: Implementar o mínimo**

`src/server/whatsapp/baileys/bansignals.ts`:
```ts
export type DisconnectAction = "BANNED" | "FATAL" | "RECONNECT";

/**
 * Mapeia o statusCode de `lastDisconnect.error` (Boom) do Baileys numa ação.
 * - 401/403 → conta deslogada/proibida = ban efetivo → tira da rotação.
 * - 440     → sessão substituída por outra → não reconectar sozinho.
 * - resto   → queda transitória → reconectar com backoff.
 */
export function classifyDisconnect(statusCode: number | undefined): DisconnectAction {
  if (statusCode === 401 || statusCode === 403) return "BANNED";
  if (statusCode === 440) return "FATAL";
  return "RECONNECT";
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/whatsapp/baileys/bansignals.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/whatsapp/baileys/bansignals.ts src/server/whatsapp/baileys/bansignals.test.ts
git commit -m "feat(baileys): classificação de desconexão (ban/fatal/reconnect)"
```

---

## Tarefa 6: Seleção de número / rotação + warm-up (lógica pura, TDD)

> Decide POR QUAL chip enviar: exclui PAUSED/BANNED/DISABLED, respeita o cap diário de cada chip e espalha a carga (menos-carregado primeiro).

**Files:**
- Create: `src/server/whatsapp/baileys/selection.ts`
- Test: `src/server/whatsapp/baileys/selection.test.ts`

**Step 1: Teste que falha**

`src/server/whatsapp/baileys/selection.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { selectNumber } from "./selection";

const N = (over: Partial<any> = {}) => ({
  id: "a", status: "CONNECTED", dailyCap: 30, sentToday: 0, ...over,
});

describe("selectNumber", () => {
  it("escolhe o número conectado MENOS carregado", () => {
    const r = selectNumber([
      N({ id: "a", sentToday: 10 }),
      N({ id: "b", sentToday: 3 }),
      N({ id: "c", sentToday: 7 }),
    ]);
    expect(r?.id).toBe("b");
  });

  it("ignora número que atingiu o próprio cap", () => {
    const r = selectNumber([
      N({ id: "a", sentToday: 30, dailyCap: 30 }),
      N({ id: "b", sentToday: 29, dailyCap: 30 }),
    ]);
    expect(r?.id).toBe("b");
  });

  it("ignora PAUSED/BANNED/DISABLED; WARMING e CONNECTED contam", () => {
    expect(selectNumber([N({ id: "a", status: "BANNED" })])).toBeNull();
    expect(selectNumber([N({ id: "a", status: "PAUSED" })])).toBeNull();
    expect(selectNumber([N({ id: "w", status: "WARMING", sentToday: 0 })])?.id).toBe("w");
  });

  it("retorna null quando todos estão no cap ou indisponíveis", () => {
    expect(selectNumber([N({ sentToday: 30, dailyCap: 30 })])).toBeNull();
    expect(selectNumber([])).toBeNull();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/whatsapp/baileys/selection.test.ts`
Expected: FAIL.

**Step 3: Implementar o mínimo**

`src/server/whatsapp/baileys/selection.ts`:
```ts
export interface NumberState {
  id: string;
  status: string; // WhatsAppNumberStatus
  dailyCap: number;
  sentToday: number;
}

const SENDABLE = new Set(["CONNECTED", "WARMING"]);

/**
 * Escolhe o chip elegível menos carregado. Elegível = status enviável e ainda
 * abaixo do próprio cap diário. Espalhar a carga (least-loaded) reduz a
 * "assinatura" de rajada num único número. Retorna null se nada elegível.
 */
export function selectNumber(numbers: NumberState[]): NumberState | null {
  const eligible = numbers.filter(
    (n) => SENDABLE.has(n.status) && n.sentToday < n.dailyCap,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, n) => (n.sentToday < best.sentToday ? n : best));
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/whatsapp/baileys/selection.test.ts`
Expected: PASS (4 testes).

**Step 5: Commit**

```bash
git add src/server/whatsapp/baileys/selection.ts src/server/whatsapp/baileys/selection.test.ts
git commit -m "feat(baileys): seleção de número (rotação least-loaded + cap por chip)"
```

---

## Tarefa 7: Pool de conexões Baileys (socket por número)

> Núcleo stateful. Vive no processo do worker. Um socket por `WhatsAppNumber`, sessão persistida em disco, reconexão, detecção de ban, e wiring de inbound/acks.

**Files:**
- Create: `src/server/whatsapp/baileys/pool.ts`
- Test: (sem unit — IO/socket; validado por `tsc` + `[SMOKE MANUAL]`)

**Step 1: Implementar o pool**

`src/server/whatsapp/baileys/pool.ts`:
```ts
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import path from "node:path";
import pino from "pino";
import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";
import { classifyDisconnect } from "./bansignals";

const logger = pino({ level: "warn" });

export interface InboundEvent {
  fromPhone: string; // E.164 com "+"
  text: string;
  providerMessageId: string | null;
  whatsAppNumberId: string;
}
export type SendOutcome =
  | { ok: true; providerMessageId: string }
  | { ok: false; reason: "no_socket" | "not_on_whatsapp" | "send_failed" };

type Handlers = {
  onInbound: (e: InboundEvent) => Promise<void>;
  onAck: (providerMessageId: string, status: "DELIVERED" | "READ") => Promise<void>;
};

const sockets = new Map<string, WASocket>();
let handlers: Handlers | null = null;

const jidOf = (phone: string) => `${phone.replace(/^\+/, "")}@s.whatsapp.net`;

export function registerHandlers(h: Handlers) {
  handlers = h;
}

/** Sobe (ou ressuscita) o socket de UM número e persiste estado/eventos. */
export async function connectNumber(numberId: string): Promise<void> {
  const rec = await prisma.whatsAppNumber.findUnique({ where: { id: numberId } });
  if (!rec || rec.status === "DISABLED" || rec.status === "BANNED") return;

  const dir = path.join(env.BAILEYS_AUTH_DIR, rec.sessionDir);
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const sock = makeWASocket({ auth: state, logger, browser: ["MiniCRM", "Chrome", "1.0"] });
  sockets.set(numberId, sock);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    if (u.qr) {
      console.log(`\n[baileys] escaneie o QR do número "${rec.label}":\n`);
      qrcode.generate(u.qr, { small: true });
    }
    if (u.connection === "open") {
      await prisma.whatsAppNumber.update({
        where: { id: numberId },
        data: { status: "CONNECTED", connectedAt: new Date(), lastError: null },
      });
      console.log(`[baileys] "${rec.label}" conectado.`);
    }
    if (u.connection === "close") {
      const code = (u.lastDisconnect?.error as Boom)?.output?.statusCode;
      const action = classifyDisconnect(code);
      sockets.delete(numberId);
      if (action === "BANNED") {
        await prisma.whatsAppNumber.update({
          where: { id: numberId },
          data: { status: "BANNED", bannedAt: new Date(), lastError: `code=${code}` },
        });
        console.error(`[baileys] "${rec.label}" BANIDO/deslogado (code=${code}) — fora da rotação.`);
      } else if (action === "RECONNECT" && code !== DisconnectReason.loggedOut) {
        console.warn(`[baileys] "${rec.label}" caiu (code=${code}) — reconectando…`);
        setTimeout(() => void connectNumber(numberId), 5000);
      } else {
        await prisma.whatsAppNumber.update({
          where: { id: numberId },
          data: { status: "DISABLED", lastError: `fatal code=${code}` },
        });
      }
    }
  });

  // Inbound → handler de domínio (handleInbound)
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" || !handlers) return;
    for (const m of messages) {
      if (m.key.fromMe || !m.key.remoteJid?.endsWith("@s.whatsapp.net")) continue;
      const text =
        m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? "";
      if (!text) continue;
      await handlers.onInbound({
        fromPhone: `+${m.key.remoteJid.split("@")[0]}`,
        text,
        providerMessageId: m.key.id ?? null,
        whatsAppNumberId: numberId,
      });
    }
  });

  // Acks de entrega/leitura → Message.status
  sock.ev.on("messages.update", async (updates) => {
    if (!handlers) return;
    for (const up of updates) {
      const s = up.update?.status;
      if (!up.key.id) continue;
      if (s === 3 /* DELIVERY_ACK */) await handlers.onAck(up.key.id, "DELIVERED");
      else if (s === 4 /* READ */) await handlers.onAck(up.key.id, "READ");
    }
  });
}

/** Verifica se o número existe no WhatsApp (sinal anti-spam). */
export async function isOnWhatsApp(numberId: string, phone: string): Promise<boolean> {
  const sock = sockets.get(numberId);
  if (!sock) return false;
  const res = await sock.onWhatsApp(jidOf(phone)).catch(() => []);
  return !!res?.[0]?.exists;
}

/** Envia com simulação humana (presence/typing). NÃO faz o delay de digitação
 *  aqui — quem chama (messaging) controla o sleep p/ manter a lógica testável. */
export async function send(
  numberId: string,
  phone: string,
  text: string,
): Promise<SendOutcome> {
  const sock = sockets.get(numberId);
  if (!sock) return { ok: false, reason: "no_socket" };
  const jid = jidOf(phone);
  try {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    return await new Promise<SendOutcome>((resolve) => {
      // pequeno "digitando" curto aqui; o delay maior fica no chamador
      setTimeout(async () => {
        try {
          await sock.sendPresenceUpdate("paused", jid).catch(() => {});
          const r = await sock.sendMessage(jid, { text });
          resolve({ ok: true, providerMessageId: r?.key?.id ?? `baileys-${numberId}` });
        } catch {
          resolve({ ok: false, reason: "send_failed" });
        }
      }, 400);
    });
  } catch {
    return { ok: false, reason: "send_failed" };
  }
}

/** Sobe todos os números não banidos/desabilitados (chamado no boot do worker). */
export async function connectAll(): Promise<void> {
  const nums = await prisma.whatsAppNumber.findMany({
    where: { status: { notIn: ["BANNED", "DISABLED"] } },
    select: { id: true },
  });
  for (const n of nums) await connectNumber(n.id);
}

export function hasLiveSocket(numberId: string): boolean {
  return sockets.has(numberId);
}
```

> Nota: instale também `@hapi/boom` se não vier transitivo: `npm i @hapi/boom`. A API do Baileys pode variar por versão (ex.: `printQRInTerminal` foi depreciado — por isso tratamos o `qr` no evento). Confirme assinaturas com a versão instalada.

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (pode exigir `npm i @hapi/boom`).

**Step 3: Commit**

```bash
git add src/server/whatsapp/baileys/pool.ts package.json package-lock.json
git commit -m "feat(baileys): pool de sockets por número (sessão, reconexão, inbound, acks, ban)"
```

---

## Tarefa 8: Adapter `WhatsAppService` + factory

**Files:**
- Modify: `src/server/whatsapp/types.ts` (mode + campo opcional no result)
- Create: `src/server/whatsapp/baileys/service.ts`
- Modify: `src/server/whatsapp/index.ts`

**Step 1: Estender a interface**

Em `src/server/whatsapp/types.ts`:
```ts
export interface WhatsAppSendResult {
  providerMessageId: string;
  /** Qual número enviou (só Baileys multi-número preenche). */
  whatsAppNumberId?: string;
}

export interface WhatsAppService {
  readonly mode: "mock" | "cloud-api" | "baileys";
  // … resto inalterado
}
```

**Step 2: Adapter Baileys**

`src/server/whatsapp/baileys/service.ts`:
```ts
import type { WhatsAppService } from "../types";

/**
 * Adapter fino: a interface genérica NÃO conhece "número". O roteamento
 * multi-número é feito no worker/messaging (que sabe escolher o chip e chamar
 * o pool). Este adapter existe só p/ o factory; envio direto sem número
 * selecionado não é suportado e falha alto (sinaliza erro de fluxo).
 */
export function createBaileysWhatsApp(): WhatsAppService {
  const err = () => {
    throw new Error(
      "Baileys é multi-número: use o caminho do worker (selectNumber + pool.send), não getWhatsApp().sendMessage direto.",
    );
  };
  return {
    mode: "baileys",
    async sendMessage() {
      return err();
    },
    async sendTemplate() {
      return err();
    },
  };
}
```

**Step 3: Wire no factory**

Em `src/server/whatsapp/index.ts`, importe e adicione o ramo:
```ts
import { createBaileysWhatsApp } from "./baileys/service";
// …
  instance =
    env.WHATSAPP_MODE === "cloud-api"
      ? createCloudWhatsApp()
      : env.WHATSAPP_MODE === "baileys"
        ? createBaileysWhatsApp()
        : createMockWhatsApp();
```

**Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 5: Commit**

```bash
git add src/server/whatsapp/types.ts src/server/whatsapp/baileys/service.ts src/server/whatsapp/index.ts
git commit -m "feat(baileys): adapter + factory (mode=baileys)"
```

---

## Tarefa 9: Caminho de envio — roteamento por número no `messaging`

> Onde a rotação encontra o pool. `dispatchOutboundJob` ganha um `numberId` opcional; quando presente (Baileys), envia pelo chip escolhido, faz `onWhatsApp`, aplica o delay humano e grava `whatsAppNumberId` em job/message/lead.

**Files:**
- Modify: `src/server/services/messaging.ts`

**Step 1: Branch Baileys no `dispatchOutboundJob`**

Em `src/server/services/messaging.ts`, ajuste a assinatura e o corpo:
```ts
import { env } from "@/lib/env";
import { typingDelayMs, sleep } from "@/lib/humanize";
import { send as poolSend, isOnWhatsApp } from "@/server/whatsapp/baileys/pool";

export async function dispatchOutboundJob(
  jobId: string,
  opts: { numberId?: string } = {},
): Promise<void> {
  const job = await prisma.outboundJob.findUnique({
    where: { id: jobId },
    include: { lead: { select: { id: true, name: true, phone: true, optOut: true } } },
  });
  if (!job || !job.lead) return;
  const { lead } = job;
  if (lead.optOut) {
    await prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", lastError: "lead em opt-out" },
    });
    return;
  }

  // ── Baileys (multi-número) ──────────────────────────────────────────────
  if (env.WHATSAPP_MODE === "baileys") {
    const numberId = opts.numberId;
    if (!numberId) throw new Error("Baileys exige numberId (rotação no worker)");

    if (env.BAILEYS_ONWHATSAPP_CHECK && !(await isOnWhatsApp(numberId, lead.phone))) {
      await prisma.outboundJob.update({
        where: { id: jobId },
        data: { status: "CANCELLED", lastError: "número não está no WhatsApp" },
      });
      return;
    }

    // simula digitação proporcional ANTES de enviar
    await sleep(
      typingDelayMs(job.content.length, {
        msPerChar: env.BAILEYS_TYPING_MS_PER_CHAR,
        maxMs: env.BAILEYS_TYPING_MAX_MS,
      }),
    );

    const out = await poolSend(numberId, lead.phone, job.content);
    if (!out.ok) throw new Error(`baileys send falhou: ${out.reason}`);

    await prisma.$transaction([
      prisma.message.create({
        data: {
          leadId: lead.id,
          direction: "OUTBOUND",
          content: job.content,
          providerMessageId: out.providerMessageId,
          status: "SENT",
          whatsAppNumberId: numberId,
        },
      }),
      prisma.outboundJob.update({
        where: { id: jobId },
        data: { status: "SENT", sentAt: new Date(), whatsAppNumberId: numberId },
      }),
      prisma.lead.update({
        where: { id: lead.id },
        data: { status: "CONTATADO", updatedAt: new Date(), whatsAppNumberId: numberId },
      }),
    ]);
    return;
  }

  // ── mock / cloud-api (caminho original, inalterado) ─────────────────────
  const wa = getWhatsApp();
  let providerMessageId: string;
  if (job.kind === "template" && env.WHATSAPP_TEMPLATE_NAME && wa.mode === "cloud-api") {
    const res = await wa.sendTemplate(
      lead.phone,
      job.templateName || env.WHATSAPP_TEMPLATE_NAME,
      env.WHATSAPP_TEMPLATE_LANG,
      [lead.name],
    );
    providerMessageId = res.providerMessageId;
  } else {
    const res = await wa.sendMessage(lead.phone, job.content);
    providerMessageId = res.providerMessageId;
  }
  await prisma.$transaction([
    prisma.message.create({
      data: { leadId: lead.id, direction: "OUTBOUND", content: job.content, providerMessageId, status: "SENT" },
    }),
    prisma.outboundJob.update({ where: { id: jobId }, data: { status: "SENT", sentAt: new Date() } }),
    prisma.lead.update({ where: { id: lead.id }, data: { status: "CONTATADO", updatedAt: new Date() } }),
  ]);
}
```

**Step 2: Resposta reativa pelo mesmo chip (`sendWhatsAppMessage`)**

Ainda em `messaging.ts`, faça `sendWhatsAppMessage` rotear pelo número dono do lead quando Baileys:
```ts
export async function sendWhatsAppMessage(
  lead: { id: string; phone: string; whatsAppNumberId?: string | null },
  text: string,
): Promise<void> {
  if (env.WHATSAPP_MODE === "baileys") {
    // responde pelo chip que iniciou a conversa; senão, qualquer um conectado
    let numberId = lead.whatsAppNumberId ?? null;
    if (!numberId) {
      const healthy = await prisma.whatsAppNumber.findFirst({
        where: { status: { in: ["CONNECTED", "WARMING"] } },
        select: { id: true },
      });
      numberId = healthy?.id ?? null;
    }
    if (!numberId) throw new Error("sem número Baileys disponível p/ responder");
    const out = await poolSend(numberId, lead.phone, text);
    if (!out.ok) throw new Error(`baileys reply falhou: ${out.reason}`);
    await prisma.message.create({
      data: { leadId: lead.id, direction: "OUTBOUND", content: text, providerMessageId: out.providerMessageId, status: "SENT", whatsAppNumberId: numberId },
    });
    await prisma.lead.update({ where: { id: lead.id }, data: { updatedAt: new Date() } });
    return;
  }
  // caminho original (mock/cloud-api):
  const wa = getWhatsApp();
  const { providerMessageId } = await wa.sendMessage(lead.phone, text);
  await prisma.message.create({
    data: { leadId: lead.id, direction: "OUTBOUND", content: text, providerMessageId, status: "SENT" },
  });
  await prisma.lead.update({ where: { id: lead.id }, data: { updatedAt: new Date() } });
}
```

> `handleInbound` já carrega o `lead` inteiro; garanta que ele passe `whatsAppNumberId` ao chamar `sendWhatsAppMessage(lead, reply)` (o objeto `lead` do `findUnique` já contém o campo). Sem mudança extra.

**Step 3: Verificar tipos e suíte**

Run: `npx tsc --noEmit && npm test`
Expected: sem erros; testes existentes seguem verdes (caminho mock/cloud-api intacto).

**Step 4: Commit**

```bash
git add src/server/services/messaging.ts
git commit -m "feat(baileys): roteamento de envio por número + onWhatsApp + delay humano"
```

---

## Tarefa 10: Worker — selecionar número e despachar

**Files:**
- Modify: `src/server/worker/dispatcher.ts`
- Modify: `src/server/worker/run.ts`

**Step 1: `sentTodayByNumber` + `processNextJob` ciente de número**

Em `dispatcher.ts`, adicione a contagem por número e propague o `numberId`:
```ts
import { env } from "@/lib/env";

/** Quantos jobs cada número já enviou hoje (p/ cap por chip). */
export async function sentTodayByNumber(now: Date): Promise<Record<string, number>> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const rows = await prisma.outboundJob.groupBy({
    by: ["whatsAppNumberId"],
    where: { status: "SENT", sentAt: { gte: start }, whatsAppNumberId: { not: null } },
    _count: { _all: true },
  });
  const map: Record<string, number> = {};
  for (const r of rows) if (r.whatsAppNumberId) map[r.whatsAppNumberId] = r._count._all;
  return map;
}
```
E altere `processNextJob` para repassar o número:
```ts
export async function processNextJob(now: Date, numberId?: string): Promise<boolean> {
  // … (seleção/claim do job idêntico) …
  try {
    await dispatchOutboundJob(candidate.id, { numberId });
    return true;
  } catch (e) {
    // … (tratamento de erro idêntico) …
  }
}
```

**Step 2: Loop do worker — escolher o chip antes de despachar**

Em `run.ts`, no modo Baileys, suba o pool no boot, registre os handlers de inbound/ack e selecione o número a cada iteração:
```ts
import { env } from "@/lib/env";
import { hourInTz, isWithinWindow, jitterMs } from "@/lib/sendWindow";
import { processNextJob, sentToday, sentTodayByNumber } from "./dispatcher";
import { selectNumber } from "@/server/whatsapp/baileys/selection";
import { sleep } from "@/lib/humanize";

async function bootBaileys() {
  const { connectAll, registerHandlers } = await import("@/server/whatsapp/baileys/pool");
  const { handleInbound } = await import("@/server/services/conversation.service");
  const { applyAck } = await import("@/server/services/webhook.service");
  registerHandlers({
    onInbound: (e) =>
      handleInbound({ phone: e.fromPhone, text: e.text, providerMessageId: e.providerMessageId }).then(() => {}),
    onAck: (id, status) => applyAck(id, status),
  });
  await connectAll();
}

async function pickNumberId(now: Date): Promise<string | null> {
  const counts = await sentTodayByNumber(now);
  const nums = await (await import("@/server/db/client")).prisma.whatsAppNumber.findMany({
    select: { id: true, status: true, dailyCap: true },
  });
  const chosen = selectNumber(
    nums.map((n) => ({ id: n.id, status: n.status, dailyCap: n.dailyCap, sentToday: counts[n.id] ?? 0 })),
  );
  return chosen?.id ?? null;
}

async function main() {
  console.log("[worker] iniciado. modo=%s cap/dia=%d", env.WHATSAPP_MODE, env.WHATSAPP_DAILY_CAP);
  if (env.WHATSAPP_MODE === "baileys") await bootBaileys();

  while (true) {
    const now = new Date();
    const hour = hourInTz(now, env.SCHEDULING_TIMEZONE);
    if (!isWithinWindow(hour, { startHour: env.WHATSAPP_SEND_START_HOUR, endHour: env.WHATSAPP_SEND_END_HOUR })) {
      await sleep(60_000); continue;
    }
    if ((await sentToday(now)) >= env.WHATSAPP_DAILY_CAP) { await sleep(60_000); continue; }

    let numberId: string | undefined;
    if (env.WHATSAPP_MODE === "baileys") {
      const id = await pickNumberId(now);
      if (!id) { await sleep(30_000); continue; } // todos no cap / sem chip saudável
      numberId = id;
    }

    const sent = await processNextJob(now, numberId);
    await sleep(sent ? env.WHATSAPP_MIN_INTERVAL_MS + jitterMs(env.WHATSAPP_JITTER_MS) : env.WORKER_POLL_MS);
  }
}

main().catch((e) => { console.error("[worker] erro fatal:", e); process.exit(1); });
```

**Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (a função `applyAck` é criada na Tarefa 12 — se rodar antes, comente o `onAck`).

**Step 4: Commit**

```bash
git add src/server/worker/
git commit -m "feat(worker): seleção de número (rotação+warm-up) e boot do pool Baileys"
```

---

## Tarefa 11: Spintax + variação no enfileiramento

**Files:**
- Modify: `src/server/services/campaign.service.ts:16` (`renderTemplate`) e `startCampaign`
- Test: `src/server/services/campaign.enqueue.test.ts` (garantir que segue verde)

**Step 1: Aplicar spintax por lead no `startCampaign`**

Em `campaign.service.ts`, importe e aplique a variação ao montar cada job (cada lead recebe uma versão sorteada → conteúdo distinto entre destinatários):
```ts
import { renderSpintax } from "@/lib/spintax";
// …
      data: campaign.leads.map((lead) => ({
        leadId: lead.id,
        campaignId,
        kind: useTemplate ? "template" : "freeform",
        content: renderTemplate(renderSpintax(campaign.messageTemplate), lead.name),
        templateName: useTemplate ? env.WHATSAPP_TEMPLATE_NAME : null,
      })),
```
> `renderSpintax` resolve `{a|b}` (aleatório por lead); `renderTemplate` troca `{{nome}}`. Ordem importa: spin primeiro, nome depois.

**Step 2: Rodar o teste de enfileiramento**

Run: `npx vitest run src/server/services/campaign.enqueue.test.ts`
Expected: PASS (se o teste casava `content` exato sem spintax no template, segue igual; templates sem `{…|…}` passam intactos).

**Step 3: Commit**

```bash
git add src/server/services/campaign.service.ts
git commit -m "feat(deliverability): spintax por lead no enfileiramento (variação anti-spam)"
```

---

## Tarefa 12: Acks → `Message.status` (reuso) e inbound por socket

**Files:**
- Modify: `src/server/services/webhook.service.ts` (extrair `applyAck` reutilizável)

**Step 1: `applyAck` compartilhável**

Em `webhook.service.ts`, adicione (e faça `applyStatuses` reusar):
```ts
/** Atualiza UMA mensagem pelo providerMessageId (usado por webhook E Baileys). */
export async function applyAck(
  providerMessageId: string,
  status: "DELIVERED" | "READ" | "FAILED" | "SENT",
): Promise<void> {
  await prisma.message.updateMany({
    where: { providerMessageId },
    data: { status },
  });
}
```
E refatore o corpo de `applyStatuses` para chamar `applyAck` (DRY).

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. Agora o `onAck` do worker (Tarefa 10) resolve.

**Step 3: Commit**

```bash
git add src/server/services/webhook.service.ts
git commit -m "feat(deliverability): applyAck reutilizável (webhook + acks do Baileys)"
```

> O webhook HTTP (`/api/webhooks/whatsapp`) **continua existindo** e só é exercitado no modo `cloud-api`. No modo `baileys` o inbound chega pelo socket (Tarefa 7 + handler na Tarefa 10).

---

## Tarefa 13: Script de pareamento de chip (QR)

> Como cadastrar um número novo: cria o `WhatsAppNumber`, sobe o socket e mostra o QR p/ escanear no WhatsApp do celular (Aparelhos conectados).

**Files:**
- Create: `scripts/wa-link.ts`
- Modify: `package.json` (script `wa:link`)

**Step 1: Implementar o script**

`scripts/wa-link.ts`:
```ts
import { prisma } from "@/server/db/client";
import { connectNumber } from "@/server/whatsapp/baileys/pool";

/** Uso: npm run wa:link -- "chip-01" "+5511999999999" */
async function main() {
  const [label, phone] = process.argv.slice(2);
  if (!label || !phone) {
    console.error('Uso: npm run wa:link -- "<label>" "<+E164>"');
    process.exit(1);
  }
  const sessionDir = label.replace(/[^a-z0-9-]/gi, "_").toLowerCase();
  const rec = await prisma.whatsAppNumber.upsert({
    where: { phone },
    update: { label, sessionDir, status: "CONNECTING" },
    create: { label, phone, sessionDir, status: "CONNECTING", dailyCap: 30 },
  });
  console.log(`[wa:link] subindo socket de "${label}" — escaneie o QR abaixo.`);
  await connectNumber(rec.id);
  // mantém o processo vivo até conectar/escanear
  await new Promise(() => {});
}
main();
```

**Step 2: Script no `package.json`**

Adicione em `scripts`:
```json
    "wa:link": "tsx scripts/wa-link.ts",
```

**Step 3: `[SMOKE MANUAL]` — parear um chip de teste**

Run (com Postgres de pé e `WHATSAPP_MODE=baileys`):
```bash
npm run wa:link -- "chip-teste" "+55SEUNUMERO"
```
Expected: QR no terminal → escanear em WhatsApp > Aparelhos conectados → log "conectado"; `WhatsAppNumber.status=CONNECTED`. Ctrl+C ao confirmar.

**Step 4: Commit**

```bash
git add scripts/wa-link.ts package.json
git commit -m "feat(baileys): script wa:link p/ parear chip via QR"
```

---

## Tarefa 14: UI mínima — números e saúde

**Files:**
- Modify: `src/server/services/campaign.service.ts` (ou um novo `numbers.service.ts`) p/ listar números + enviados hoje
- Modify: componente de status (reusar `Badge`)

**Step 1: Listar números com enviados-hoje**

Crie `listWhatsAppNumbers()` retornando `{ id, label, phone, status, dailyCap, sentToday }` (reusar `sentTodayByNumber`). Exibir numa seção simples do dashboard com badge por `status` (CONNECTED/WARMING/PAUSED/BANNED).

**Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: build OK.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): painel de números Baileys (status + enviados hoje)"
```

---

## Tarefa 15: Documentação — operação, warm-up e fallback

**Files:**
- Modify: `README.md`
- Modify: `ANALISE-WHATSAPP.md`

**Step 1: Documentar a operação Baileys**

Acrescente ao README:
- **Trocar de transporte:** `WHATSAPP_MODE=baileys` (não-oficial, multi-número) ↔ `cloud-api` (oficial, fallback). O `cloud-api.ts` permanece intacto — em campanha crítica ou se todos os chips caírem, troca-se a env var.
- **Parear chip:** `npm run wa:link -- "<label>" "<+E164>"` e escanear o QR. Sessões ficam em `BAILEYS_AUTH_DIR` (NÃO commitar).
- **Warm-up obrigatório:** começar cada chip em `dailyCap` baixo (~20–30/dia) e subir ao longo de 2–4 semanas observando quedas/bans. **1.000/dia exige múltiplos chips** — total/dia ≈ soma dos caps (limitado por `WHATSAPP_DAILY_CAP` global).
- **Higiene:** IP estável (evitar datacenter volátil), não re-parear à toa, manter o celular-mãe online, opt-in real (taxa de denúncia é o que mais derruba).
- **Ban:** detectado no `connection.update` (401/403) → número vira `BANNED` e sai da rotação; os demais seguem. Repor chip com `wa:link`.
- **Worker persistente:** Baileys precisa de processo vivo (Railway/Render/Fly) — Vercel serverless não segura socket.

**Step 2: Atualizar `ANALISE-WHATSAPP.md`**

Registrar que existe agora o caminho B (Baileys multi-número) como alternativa selecionável, com os trade-offs de risco.

**Step 3: Commit**

```bash
git add README.md ANALISE-WHATSAPP.md
git commit -m "docs: operação Baileys multi-número, warm-up, higiene e fallback p/ cloud-api"
```

---

## Verificação final (end-to-end)

1. `WHATSAPP_MODE=mock` → `npm test` + `npm run build`: tudo verde (nada quebrou no caminho original).
2. `WHATSAPP_MODE=baileys`, Postgres de pé: `npm run wa:link` p/ 2 chips de teste → ambos `CONNECTED`.
3. `npm run dev` + `npm run worker`: criar campanha com 4–5 leads (alguns números sem WhatsApp) → confirmar:
   - jobs despachados **espaçados** e **alternando entre os 2 chips** (rotação least-loaded);
   - número sem WhatsApp → job `CANCELLED` ("número não está no WhatsApp");
   - cada chip respeita seu `dailyCap` (subir o cap e ver mais envios).
4. Responder como lead → inbound chega **pelo socket**, `handleInbound` roda, resposta sai **pelo mesmo chip** (`Lead.whatsAppNumberId`).
5. Responder "PARAR" → lead `DESCARTADO`/optOut, jobs pendentes `CANCELLED`.
6. Forçar logout de um chip (remover Aparelho conectado no celular) → `connection.update` 401 → número vira `BANNED` e sai da rotação; o outro chip continua enviando.
7. Conferir acks: `Message.status` migra p/ `DELIVERED`/`READ`.

## Fora de escopo (próximos passos)

- Proxy/residencial por número e fingerprint de device por chip.
- Backoff adaptativo de cap por número conforme sinais de saúde (auto warm-up).
- Métricas de custo-por-lead-qualificado e taxa de denúncia por chip.
- Migração `db push` → `prisma migrate` versionado (go-live de banco gerenciado).
