# BYOK — Chave de API do próprio usuário (OpenAI + Anthropic) — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que cada usuário cadastre, na aba Configurações, a própria chave de API (OpenAI **ou** Anthropic), criptografada em repouso; quando configurada, os agentes de IA passam a usar a chave do usuário, caindo para a chave da plataforma (`OPENAI_API_KEY`) como fallback.

**Architecture:** Hoje a IA é um singleton global OpenAI (`getOpenAI()`), consumido por 3 funções de agente. Vamos (1) guardar a credencial cifrada no `User` (AES-256-GCM), (2) substituir o singleton por uma fábrica por-usuário `getAiClient(userId)` por trás de uma interface `AiClient` de dois métodos (`generateText`, `forcedToolCall`), com adaptadores OpenAI e Anthropic, e (3) threadar `userId` (via `lead.userId`) até os agentes. UI + rotas de API para salvar/testar/remover a chave (a chave nunca volta ao cliente — só os 4 últimos dígitos).

**Tech Stack:** Next.js (App Router), TypeScript, Prisma + PostgreSQL, Zod, Vitest, `openai` SDK (já presente), `@anthropic-ai/sdk` (novo), Node `crypto` (AES-256-GCM).

---

## Decisões já tomadas (não reabrir)

- **Fallback para a plataforma:** usuário sem chave própria usa `OPENAI_API_KEY`.
- **Providers:** OpenAI **e** Anthropic.
- **Modelos por provider (default fixo, sem UI de escolha de modelo no MVP):**
  - OpenAI → cheap `gpt-4o-mini`, strong `gpt-4o` (mantém `env.AI_MODEL_CHEAP/STRONG`).
  - Anthropic → cheap `claude-haiku-4-5`, strong `claude-opus-4-8`.
- **Segurança:** chave cifrada com AES-256-GCM usando `ENCRYPTION_KEY` do `.env`. Texto puro só existe em memória no servidor no momento da chamada. UI vê apenas `last4`.
- Modelos Anthropic chamados via Messages API **sem** `thinking` (tarefas curtas/estruturadas) — `thinking: {type:"adaptive"}` é desnecessário aqui e adiciona latência.

---

## Task 0: Dependência e chave mestra

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env`, `.env.example`
- Modify: `src/lib/env.ts`

**Step 1: Instalar o SDK da Anthropic**

Run:
```bash
npm install @anthropic-ai/sdk
```
Expected: adiciona `@anthropic-ai/sdk` em `dependencies`, sem erros.

**Step 2: Gerar uma chave mestra de 32 bytes (hex)**

Run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copie o valor (64 chars hex).

**Step 3: Adicionar `ENCRYPTION_KEY` ao `.env` e `.env.example`**

No `.env` (valor real gerado acima):
```
ENCRYPTION_KEY=<64-chars-hex>
```
No `.env.example` (placeholder, com comentário):
```
# Chave mestra (32 bytes em hex) para cifrar credenciais de IA dos usuários (AES-256-GCM).
# Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=
```

**Step 4: Validar `ENCRYPTION_KEY` no schema de env**

Em `src/lib/env.ts`, dentro do `z.object({ ... })` (perto de `OPENAI_API_KEY`), adicione:
```ts
  // Chave mestra p/ cifrar credenciais de IA dos usuários (BYOK). 64 hex = 32 bytes.
  // Opcional p/ não quebrar build/avaliador; o factory de crypto exige em runtime.
  ENCRYPTION_KEY: z.string().optional().default(""),
```
Depois do bloco `export const isAiConfigured = ...`, adicione:
```ts
/** BYOK exige a chave mestra de 32 bytes (64 hex). */
export const isEncryptionConfigured = /^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY);
```

**Step 5: Commit**
```bash
git add package.json package-lock.json .env.example src/lib/env.ts
git commit -m "chore(byok): add anthropic sdk e ENCRYPTION_KEY"
```
(`.env` não entra no commit — está no .gitignore.)

---

## Task 1: Lib de criptografia (AES-256-GCM)

**Files:**
- Create: `src/server/crypto.ts`
- Test: `src/server/crypto.test.ts`

**Step 1: Escrever o teste que falha**

`src/server/crypto.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";

// ENCRYPTION_KEY precisa existir antes de importar o módulo (lê via env).
beforeAll(() => {
  process.env.ENCRYPTION_KEY =
    "0000000000000000000000000000000000000000000000000000000000000000";
});

describe("crypto BYOK", () => {
  it("round-trip: decrypt(encrypt(x)) === x", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const secret = "sk-proj-abc123XYZ";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret); // cifrado, não texto puro
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("ciphertext difere a cada chamada (IV aleatório)", async () => {
    const { encryptSecret } = await import("./crypto");
    expect(encryptSecret("mesma-coisa")).not.toBe(encryptSecret("mesma-coisa"));
  });

  it("decrypt falha em payload adulterado", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const enc = encryptSecret("segredo");
    const tampered = enc.slice(0, -2) + (enc.endsWith("aa") ? "bb" : "aa");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/crypto.test.ts`
Expected: FAIL (`Cannot find module './crypto'`).

**Step 3: Implementar**

`src/server/crypto.ts`:
```ts
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "crypto";

/**
 * Cifra simétrica para credenciais de IA dos usuários (BYOK).
 * AES-256-GCM. Formato persistido: "<iv-hex>:<authTag-hex>:<ciphertext-hex>".
 * A chave mestra (32 bytes) vem de ENCRYPTION_KEY (64 chars hex).
 */
const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ENCRYPTION_KEY ausente ou inválida (esperado 64 chars hex = 32 bytes).",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96 bits, recomendado p/ GCM
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Payload cifrado malformado.");
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/crypto.test.ts`
Expected: PASS (3 testes).

**Step 5: Commit**
```bash
git add src/server/crypto.ts src/server/crypto.test.ts
git commit -m "feat(byok): lib de cifra AES-256-GCM p/ credenciais de IA"
```

---

## Task 2: Schema Prisma — campos de credencial no User

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Adicionar enum e campos**

Antes do `model User` (junto dos outros enums), adicione:
```prisma
enum AiProvider {
  OPENAI
  ANTHROPIC
}
```
Dentro de `model User`, após `updatedAt`, adicione:
```prisma
  // BYOK: credencial de IA do usuário (null = usa a chave da plataforma).
  aiProvider      AiProvider? // OPENAI | ANTHROPIC | null
  aiKeyEnc        String? // chave cifrada (AES-256-GCM): "iv:tag:ciphertext"
  aiKeyLast4      String? // 4 últimos dígitos p/ exibir na UI sem revelar
  aiKeyVerifiedAt DateTime? // última validação bem-sucedida contra a API
```

**Step 2: Aplicar ao banco**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." e regeneração do client.

**Step 3: Verificar o client tipado**

Run: `npx prisma generate`
Expected: sucesso; `AiProvider` disponível em `@prisma/client`.

**Step 4: Commit**
```bash
git add prisma/schema.prisma
git commit -m "feat(byok): campos de credencial de IA no User"
```

---

## Task 3: Interface AiClient + adaptadores (provider refactor)

**Files:**
- Modify: `src/server/ai/provider.ts`
- Test: `src/server/ai/provider.test.ts`

**Step 1: Teste que falha (forma da interface + roteamento)**

`src/server/ai/provider.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("provider AiClient", () => {
  it("buildAiClient(openai) expõe generateText e forcedToolCall", async () => {
    const { buildAiClient } = await import("./provider");
    const ai = buildAiClient({ provider: "OPENAI", apiKey: "sk-test" });
    expect(typeof ai.generateText).toBe("function");
    expect(typeof ai.forcedToolCall).toBe("function");
  });

  it("buildAiClient(anthropic) expõe a mesma interface", async () => {
    const { buildAiClient } = await import("./provider");
    const ai = buildAiClient({ provider: "ANTHROPIC", apiKey: "sk-ant-test" });
    expect(typeof ai.generateText).toBe("function");
    expect(typeof ai.forcedToolCall).toBe("function");
  });

  it("MODELS expõe cheap/strong por provider", async () => {
    const { MODELS_BY_PROVIDER } = await import("./provider");
    expect(MODELS_BY_PROVIDER.OPENAI.strong).toBeTruthy();
    expect(MODELS_BY_PROVIDER.ANTHROPIC.strong).toContain("claude");
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/ai/provider.test.ts`
Expected: FAIL (`buildAiClient` / `MODELS_BY_PROVIDER` não existem).

**Step 3: Implementar o provider refatorado**

Substitua **todo** o conteúdo de `src/server/ai/provider.ts` por:
```ts
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

export type AiProviderName = "OPENAI" | "ANTHROPIC";

/** Tiering de modelos por provider (cheap = barato/rápido, strong = decisões). */
export const MODELS_BY_PROVIDER = {
  OPENAI: { cheap: env.AI_MODEL_CHEAP, strong: env.AI_MODEL_STRONG },
  ANTHROPIC: { cheap: "claude-haiku-4-5", strong: "claude-opus-4-8" },
} as const;

export type Tier = "cheap" | "strong";

export interface ForcedToolCallOpts {
  tier: Tier;
  system: string;
  user: string;
  maxTokens: number;
  toolName: string;
  toolDescription: string;
  /** JSON Schema dos parâmetros da tool. */
  jsonSchema: Record<string, unknown>;
}

export interface GenerateTextOpts {
  tier: Tier;
  system: string;
  user: string;
  maxTokens: number;
}

/**
 * Abstração mínima sobre os dois SDKs. Dois usos no produto:
 *  - generateText: 1 saída de texto livre (próxima pergunta).
 *  - forcedToolCall: força chamada de 1 tool → objeto JSON (qualificação, slot).
 * Retorna o objeto de argumentos cru (ou null se o modelo não chamou a tool);
 * a validação zod fica no chamador.
 */
export interface AiClient {
  generateText(opts: GenerateTextOpts): Promise<string>;
  forcedToolCall(opts: ForcedToolCallOpts): Promise<unknown | null>;
}

// ───────────────────────── OpenAI ─────────────────────────

function openAiClient(apiKey: string): AiClient {
  const client = new OpenAI({ apiKey });
  const models = MODELS_BY_PROVIDER.OPENAI;

  return {
    async generateText({ tier, system, user, maxTokens }) {
      const res = await client.chat.completions.create({
        model: models[tier],
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      return (res.choices[0]?.message?.content ?? "").trim();
    },

    async forcedToolCall({ tier, system, user, maxTokens, toolName, toolDescription, jsonSchema }) {
      const res = await client.chat.completions.create({
        model: models[tier],
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: toolName,
              description: toolDescription,
              parameters: jsonSchema as unknown as Record<string, unknown>,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: toolName } },
      });
      const call = res.choices[0]?.message?.tool_calls?.[0];
      if (!call || call.type !== "function") return null;
      try {
        return JSON.parse(call.function.arguments);
      } catch {
        return null;
      }
    },
  };
}

// ──────────────────────── Anthropic ────────────────────────

function anthropicClient(apiKey: string): AiClient {
  const client = new Anthropic({ apiKey });
  const models = MODELS_BY_PROVIDER.ANTHROPIC;

  return {
    async generateText({ tier, system, user, maxTokens }) {
      const res = await client.messages.create({
        model: models[tier],
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      });
      const block = res.content.find((b) => b.type === "text");
      return block && block.type === "text" ? block.text.trim() : "";
    },

    async forcedToolCall({ tier, system, user, maxTokens, toolName, toolDescription, jsonSchema }) {
      const res = await client.messages.create({
        model: models[tier],
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [
          {
            name: toolName,
            description: toolDescription,
            input_schema: jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: toolName },
      });
      const block = res.content.find((b) => b.type === "tool_use");
      // input já vem como objeto parseado no SDK da Anthropic.
      return block && block.type === "tool_use" ? block.input : null;
    },
  };
}

/** Constrói um AiClient para um provider + chave específicos. */
export function buildAiClient(opts: { provider: AiProviderName; apiKey: string }): AiClient {
  return opts.provider === "ANTHROPIC"
    ? anthropicClient(opts.apiKey)
    : openAiClient(opts.apiKey);
}
```

> Nota: a referência `claude-api` confirma os model IDs (`claude-haiku-4-5`, `claude-opus-4-8`), `messages.create` com `tools` + `tool_choice: {type:"tool", name}`, e que prefill/`thinking enabled` não se aplicam aqui. Tarefas curtas → sem `thinking`.

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/ai/provider.test.ts`
Expected: PASS (3 testes).

**Step 5: Commit**
```bash
git add src/server/ai/provider.ts src/server/ai/provider.test.ts
git commit -m "feat(byok): interface AiClient + adaptadores OpenAI/Anthropic"
```

---

## Task 4: Resolução por-usuário com fallback (getAiClient)

**Files:**
- Create: `src/server/ai/resolve.ts`
- Test: `src/server/ai/resolve.test.ts`

**Step 1: Teste que falha (fallback quando user não tem chave)**

`src/server/ai/resolve.test.ts`:
```ts
import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.ENCRYPTION_KEY =
    "0000000000000000000000000000000000000000000000000000000000000000";
  process.env.OPENAI_API_KEY = "sk-platform-test";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe("getAiClient", () => {
  it("usa a credencial do usuário quando existe", async () => {
    const { prisma } = await import("@/server/db/client");
    const { encryptSecret } = await import("@/server/crypto");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: "ANTHROPIC",
      aiKeyEnc: encryptSecret("sk-ant-user"),
    });
    const { resolveProviderForUser } = await import("./resolve");
    const r = await resolveProviderForUser("user-1");
    expect(r.provider).toBe("ANTHROPIC");
    expect(r.apiKey).toBe("sk-ant-user");
    expect(r.source).toBe("user");
  });

  it("cai para a plataforma (OpenAI) quando o usuário não configurou", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: null,
      aiKeyEnc: null,
    });
    const { resolveProviderForUser } = await import("./resolve");
    const r = await resolveProviderForUser("user-2");
    expect(r.provider).toBe("OPENAI");
    expect(r.apiKey).toBe("sk-platform-test");
    expect(r.source).toBe("platform");
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/ai/resolve.test.ts`
Expected: FAIL (`./resolve` não existe).

**Step 3: Implementar**

`src/server/ai/resolve.ts`:
```ts
import { prisma } from "@/server/db/client";
import { env, isAiConfigured } from "@/lib/env";
import { decryptSecret } from "@/server/crypto";
import { buildAiClient, type AiClient, type AiProviderName } from "./provider";

export interface ResolvedProvider {
  provider: AiProviderName;
  apiKey: string;
  source: "user" | "platform";
}

/**
 * Decide qual provider/chave usar para um usuário:
 *  - se ele configurou a própria chave → usa a dele;
 *  - senão → cai para a chave da plataforma (OPENAI_API_KEY).
 */
export async function resolveProviderForUser(userId: string): Promise<ResolvedProvider> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiProvider: true, aiKeyEnc: true },
  });

  if (user?.aiProvider && user.aiKeyEnc) {
    return {
      provider: user.aiProvider,
      apiKey: decryptSecret(user.aiKeyEnc),
      source: "user",
    };
  }

  if (!isAiConfigured) {
    throw new Error(
      "Nenhuma chave de IA disponível: o usuário não configurou a própria e a plataforma não tem OPENAI_API_KEY.",
    );
  }
  return { provider: "OPENAI", apiKey: env.OPENAI_API_KEY, source: "platform" };
}

/** Atalho: AiClient pronto para o usuário (chave própria ou fallback). */
export async function getAiClient(userId: string): Promise<AiClient> {
  const { provider, apiKey } = await resolveProviderForUser(userId);
  return buildAiClient({ provider, apiKey });
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/ai/resolve.test.ts`
Expected: PASS (2 testes).

**Step 5: Commit**
```bash
git add src/server/ai/resolve.ts src/server/ai/resolve.test.ts
git commit -m "feat(byok): getAiClient por-usuario com fallback p/ plataforma"
```

---

## Task 5: Migrar os agentes para AiClient (thread userId)

**Files:**
- Modify: `src/server/ai/conversation.agent.ts`
- Modify: `src/server/ai/qualification.agent.ts`
- Modify: `src/server/services/conversation.service.ts:187`
- Modify: `src/server/services/qualification.service.ts:16`
- Modify: `src/server/services/scheduling.service.ts:69`
- Modify: `scripts/ai-smoke.ts`

> Nenhum teste novo aqui (a refatoração é coberta pelos evals existentes em `agents.eval.test.ts`, que rodam só com `RUN_AI_EVALS=1`). Validação principal: TypeScript compila e o smoke roda.

**Step 1: `qualification.agent.ts` — receber `ai` e usar `forcedToolCall`**

Troque o import e a assinatura/corpo de `runQualification`:
```ts
import { QUALIFICATION_SYSTEM } from "./prompts";
import { formatTranscript, type ConversationTurn } from "./transcript";
import {
  qualificationJsonSchema,
  qualificationSchema,
  type QualificationResult,
} from "./schemas";
import type { AiClient } from "./provider";

export type { ConversationTurn };

export async function runQualification(opts: {
  ai: AiClient;
  leadName: string;
  conversation: ConversationTurn[];
}): Promise<QualificationResult> {
  const input = await opts.ai.forcedToolCall({
    tier: "strong",
    maxTokens: 1024,
    system: QUALIFICATION_SYSTEM,
    user: `Lead: ${opts.leadName}\n\nConversa até agora:\n${formatTranscript(opts.conversation)}`,
    toolName: "registrar_qualificacao",
    toolDescription: "Registra a qualificação estruturada do lead.",
    jsonSchema: qualificationJsonSchema as unknown as Record<string, unknown>,
  });

  if (input == null) {
    throw new Error("Agente de qualificação não retornou tool_call.");
  }
  const parsed = qualificationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Saída de qualificação inválida: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}
```

**Step 2: `conversation.agent.ts` — idem para as duas funções**

```ts
import { CONVERSATION_SYSTEM, SLOT_CHOICE_SYSTEM } from "./prompts";
import {
  slotChoiceJsonSchema,
  slotChoiceSchema,
  type QualificationResult,
  type SlotChoice,
} from "./schemas";
import { formatTranscript, type ConversationTurn } from "./transcript";
import type { AiClient } from "./provider";

export async function generateNextQuestion(opts: {
  ai: AiClient;
  leadName: string;
  conversation: ConversationTurn[];
  qualification: QualificationResult;
}): Promise<string> {
  const text = await opts.ai.generateText({
    tier: "cheap",
    maxTokens: 300,
    system: CONVERSATION_SYSTEM,
    user:
      `Lead: ${opts.leadName}\n` +
      `Leitura atual da IA: ${opts.qualification.summary} (score ${opts.qualification.score})\n\n` +
      `Conversa:\n${formatTranscript(opts.conversation)}\n\n` +
      `Escreva a próxima mensagem.`,
  });
  return text || "Pode me contar um pouco mais sobre o seu cenário atual?";
}

export async function interpretSlotChoice(opts: {
  ai: AiClient;
  formattedSlots: string[];
  leadMessage: string;
}): Promise<SlotChoice> {
  const list = opts.formattedSlots.map((s, i) => `[${i}] ${s}`).join("\n");
  const input = await opts.ai.forcedToolCall({
    tier: "cheap",
    maxTokens: 256,
    system: SLOT_CHOICE_SYSTEM,
    user: `Horários oferecidos:\n${list}\n\nMensagem do lead: "${opts.leadMessage}"`,
    toolName: "registrar_escolha",
    toolDescription: "Registra qual horário o lead escolheu.",
    jsonSchema: slotChoiceJsonSchema as unknown as Record<string, unknown>,
  });
  if (input == null) return { chosenIndex: null, confident: false };
  const parsed = slotChoiceSchema.safeParse(input);
  return parsed.success ? parsed.data : { chosenIndex: null, confident: false };
}
```

**Step 3: Atualizar os 3 call sites (services)**

Em cada service, importe `getAiClient` e passe `ai` (use o `userId` do lead já carregado no contexto):
- `conversation.service.ts`: antes da chamada `generateNextQuestion(...)`, adicione `const ai = await getAiClient(lead.userId);` e passe `ai` no objeto de opts.
- `qualification.service.ts`: `const ai = await getAiClient(lead.userId);` antes de `runQualification(...)`, passar `ai`.
- `scheduling.service.ts`: `const ai = await getAiClient(lead.userId);` antes de `interpretSlotChoice(...)`, passar `ai`.

> Importe com: `import { getAiClient } from "@/server/ai/resolve";`
> Se em algum desses pontos o objeto disponível não tiver `userId` (ex.: só `leadId`), carregue-o: `const { userId } = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { userId: true } });`. **Abra cada arquivo e confirme a variável correta antes de editar.**

**Step 4: Atualizar `scripts/ai-smoke.ts`**

Adicione no topo do uso: construa um client de plataforma e passe `ai`:
```ts
import { buildAiClient } from "@/server/ai/provider";
// ...
const ai = buildAiClient({ provider: "OPENAI", apiKey: process.env.OPENAI_API_KEY! });
const qual = await runQualification({ ai, leadName: "João", conversation });
const next = await generateNextQuestion({ ai, /* ...resto das opts... */ });
```

**Step 5: Atualizar os evals `agents.eval.test.ts`**

Esses testes chamam `runQualification`/`interpretSlotChoice` direto. Injete um `ai` de plataforma no início de cada chamada (mesmo padrão do smoke). Só rodam com `RUN_AI_EVALS=1`, mas precisam compilar.

**Step 6: Type-check + lint do projeto**

Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npm run lint` (se existir)
Expected: sem erros novos.

**Step 7: Smoke da IA (opcional, exige OPENAI_API_KEY real)**

Run: `npx tsx scripts/ai-smoke.ts` (ou o runner usado no repo)
Expected: imprime qualificação + próxima pergunta sem erro.

**Step 8: Commit**
```bash
git add src/server/ai/conversation.agent.ts src/server/ai/qualification.agent.ts \
  src/server/services/conversation.service.ts src/server/services/qualification.service.ts \
  src/server/services/scheduling.service.ts scripts/ai-smoke.ts src/server/ai/agents.eval.test.ts
git commit -m "refactor(byok): agentes usam AiClient por-usuario (thread userId)"
```

---

## Task 6: Serviço de credencial (salvar / testar / remover / status)

**Files:**
- Create: `src/server/services/ai-credential.service.ts`
- Test: `src/server/services/ai-credential.service.test.ts`

**Step 1: Teste que falha (status mascarado)**

`src/server/services/ai-credential.service.test.ts`:
```ts
import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.ENCRYPTION_KEY =
    "0000000000000000000000000000000000000000000000000000000000000000";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

describe("getAiCredentialStatus", () => {
  it("retorna mascarado quando configurado", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: "OPENAI",
      aiKeyLast4: "1234",
      aiKeyVerifiedAt: new Date("2026-06-19T00:00:00Z"),
    });
    const { getAiCredentialStatus } = await import("./ai-credential.service");
    const s = await getAiCredentialStatus("u1");
    expect(s).toEqual({
      configured: true,
      provider: "OPENAI",
      last4: "1234",
      verifiedAt: "2026-06-19T00:00:00.000Z",
    });
  });

  it("retorna não-configurado quando vazio", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: null,
      aiKeyLast4: null,
      aiKeyVerifiedAt: null,
    });
    const { getAiCredentialStatus } = await import("./ai-credential.service");
    expect((await getAiCredentialStatus("u1")).configured).toBe(false);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/ai-credential.service.test.ts`
Expected: FAIL (módulo não existe).

**Step 3: Implementar**

`src/server/services/ai-credential.service.ts`:
```ts
import { prisma } from "@/server/db/client";
import { encryptSecret } from "@/server/crypto";
import { buildAiClient, type AiProviderName } from "@/server/ai/provider";

export interface AiCredentialStatus {
  configured: boolean;
  provider: AiProviderName | null;
  last4: string | null;
  verifiedAt: string | null;
}

export async function getAiCredentialStatus(userId: string): Promise<AiCredentialStatus> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiProvider: true, aiKeyLast4: true, aiKeyVerifiedAt: true },
  });
  return {
    configured: !!u?.aiProvider,
    provider: u?.aiProvider ?? null,
    last4: u?.aiKeyLast4 ?? null,
    verifiedAt: u?.aiKeyVerifiedAt ? u.aiKeyVerifiedAt.toISOString() : null,
  };
}

/** Faz uma chamada barata p/ validar a chave antes de persistir. */
async function testKey(provider: AiProviderName, apiKey: string): Promise<void> {
  const ai = buildAiClient({ provider, apiKey });
  // generateText "cheap" com 1 token: valida auth sem custo relevante.
  await ai.generateText({ tier: "cheap", maxTokens: 1, system: "ping", user: "ping" });
}

/**
 * Valida a chave contra a API do provider e, se ok, persiste cifrada.
 * Lança erro amigável se a chave for inválida.
 */
export async function saveAiCredential(
  userId: string,
  provider: AiProviderName,
  apiKey: string,
): Promise<AiCredentialStatus> {
  const key = apiKey.trim();
  if (key.length < 12) throw new Error("Chave de API inválida.");

  try {
    await testKey(provider, key);
  } catch {
    throw new Error("Não consegui validar a chave. Confira o provider e a chave.");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      aiProvider: provider,
      aiKeyEnc: encryptSecret(key),
      aiKeyLast4: key.slice(-4),
      aiKeyVerifiedAt: new Date(),
    },
  });
  return getAiCredentialStatus(userId);
}

export async function removeAiCredential(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { aiProvider: null, aiKeyEnc: null, aiKeyLast4: null, aiKeyVerifiedAt: null },
  });
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/ai-credential.service.test.ts`
Expected: PASS (2 testes).

**Step 5: Commit**
```bash
git add src/server/services/ai-credential.service.ts src/server/services/ai-credential.service.test.ts
git commit -m "feat(byok): servico de credencial (salvar/testar/remover/status)"
```

---

## Task 7: Rotas de API (status / salvar / remover)

**Files:**
- Create: `src/app/api/account/ai-key/route.ts`

> Padrão do repo: a UI já usa `fetch("/api/account/...")` (ver `AccountSettings.tsx`). Seguimos route handlers. Confirme como obter o usuário logado no servidor — o repo usa `getCurrentUserId()` de `@/lib/session` (ver `configuracoes/page.tsx`).

**Step 1: Implementar o route handler**

`src/app/api/account/ai-key/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/session";
import {
  getAiCredentialStatus,
  saveAiCredential,
  removeAiCredential,
} from "@/server/services/ai-credential.service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: z.enum(["OPENAI", "ANTHROPIC"]),
  apiKey: z.string().min(12),
});

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  return NextResponse.json(await getAiCredentialStatus(userId));
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  try {
    const status = await saveAiCredential(userId, parsed.data.provider, parsed.data.apiKey);
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar." },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  await removeAiCredential(userId);
  return NextResponse.json({ ok: true });
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros. (Se `getCurrentUserId` tiver outra assinatura, ajuste — confira `@/lib/session`.)

**Step 3: Commit**
```bash
git add src/app/api/account/ai-key/route.ts
git commit -m "feat(byok): rotas GET/POST/DELETE /api/account/ai-key"
```

---

## Task 8: UI — card de chave de API em Configurações

**Files:**
- Modify: `src/components/app/AccountSettings.tsx`
- Modify: `src/app/(app)/configuracoes/page.tsx`

**Step 1: Passar o status inicial via props**

Em `configuracoes/page.tsx`, busque o status e passe ao componente:
```ts
import { getAiCredentialStatus } from "@/server/services/ai-credential.service";
// ...dentro do componente, após obter user:
const aiKey = await getAiCredentialStatus(userId);
// ...no JSX:
<AccountSettings
  account={{ /* ...igual... */ }}
  aiKey={aiKey}
/>
```

**Step 2: Estender o componente com o card**

Em `AccountSettings.tsx`:
- Adicione ao tipo de props: `aiKey: { configured: boolean; provider: "OPENAI" | "ANTHROPIC" | null; last4: string | null; verifiedAt: string | null }`.
- Adicione estado local: `provider` (default `aiKey.provider ?? "OPENAI"`), `keyInput`, `saving`, `error`, e um `status` espelhando `aiKey`.
- Funções:
```tsx
async function saveKey() {
  setSaving(true); setError(null);
  try {
    const res = await fetch("/api/account/ai-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey: keyInput }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Erro ao salvar.");
    setStatus(data); setKeyInput("");
  } catch (e) {
    setError(e instanceof Error ? e.message : "Erro ao salvar.");
  } finally { setSaving(false); }
}

async function removeKey() {
  await fetch("/api/account/ai-key", { method: "DELETE" });
  setStatus({ configured: false, provider: null, last4: null, verifiedAt: null });
}
```
- JSX (novo `<Card>` antes da "Zona de perigo"):
```tsx
<Card>
  <CardHeader
    title="Chave de API de IA"
    subtitle="Use sua própria chave (OpenAI ou Anthropic). Se não configurar, usamos a chave da plataforma."
  />
  <div className="space-y-3 px-5 py-4">
    {status.configured ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {status.provider} • chave terminando em <strong>••••{status.last4}</strong>
          {status.verifiedAt ? ` • validada` : ""}
        </p>
        <Button variant="secondary" onClick={removeKey}>Remover</Button>
      </div>
    ) : (
      <>
        <div className="flex gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as "OPENAI" | "ANTHROPIC")}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="OPENAI">OpenAI</option>
            <option value="ANTHROPIC">Anthropic</option>
          </select>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={provider === "OPENAI" ? "sk-..." : "sk-ant-..."}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-[#C0392B]">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={saveKey} loading={saving} disabled={keyInput.length < 12}>
            Testar e salvar
          </Button>
        </div>
      </>
    )}
  </div>
</Card>
```
> Ajuste classes/props (`Button`, `Card`) ao padrão real do repo se divergir. Não invente componentes novos.

**Step 3: Rodar a app e validar manualmente**

Run: `npm run dev`
Verificações em `/configuracoes`:
1. Sem chave → mostra select + input + "Testar e salvar".
2. Salvar chave inválida → erro amigável, nada persiste.
3. Salvar chave válida (OpenAI) → vira "OpenAI • ••••XXXX • validada"; "Remover" aparece.
4. "Remover" → volta ao formulário.
5. Reload da página → estado persiste (vem do servidor).

**Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 5: Commit**
```bash
git add src/components/app/AccountSettings.tsx "src/app/(app)/configuracoes/page.tsx"
git commit -m "feat(byok): card de chave de API em Configuracoes"
```

---

## Task 9: Verificação end-to-end

**Step 1: Suíte de testes completa**

Run: `npx vitest run`
Expected: todos verdes (evals de IA pulados sem `RUN_AI_EVALS=1`).

**Step 2: Build**

Run: `npm run build`
Expected: build conclui sem erro (mesmo sem `ENCRYPTION_KEY`/`OPENAI_API_KEY` no ambiente de build — campos são opcionais).

**Step 3: Teste manual do fluxo de IA com chave do usuário**

Com `OPENAI_API_KEY` da plataforma vazia e uma chave Anthropic real salva por um usuário, dispare uma conversa que aciona `generateNextQuestion`/`runQualification` e confirme que responde via Anthropic. Depois remova a chave e confirme o fallback (precisa da chave de plataforma).

**Step 4: Commit final (se houver ajustes)**
```bash
git add -A
git commit -m "test(byok): verificacao e2e do fluxo BYOK"
```

---

## Notas de segurança / produção (fora do MVP, registrar como follow-up)

- **Rotação de `ENCRYPTION_KEY`:** trocar a chave invalida todas as `aiKeyEnc`. Se for rotacionar, prever migração (decifrar com a antiga, recifrar com a nova) ou versionar a chave (prefixo `v1:` no payload).
- **Export LGPD:** `exportUserData` **não** deve incluir `aiKeyEnc` (já não inclui — o `select` é explícito; manter assim).
- **Rate-limit** na rota POST (validação chama a API externa) — considerar throttle por usuário.
- **Custo do teste de chave:** `maxTokens: 1` mantém o custo desprezível; se algum provider recusar `max_tokens` muito baixo, suba para ~16.
```