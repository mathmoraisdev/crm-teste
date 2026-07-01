# Transcrição de Áudio para a IA — Plano de Implementação

> **Para o Claude:** SUB-SKILL OBRIGATÓRIA: use `executing-plans` para implementar este plano tarefa a tarefa.

**Goal:** Fazer a IA de atendimento entender notas de voz do lead — transcrevendo o áudio já baixado para texto e injetando no fluxo de resposta que já existe — sem perder o player inline do operador.

**Architecture:** O download e o upload do áudio para o Storage já acontecem (commit `ec06c99`, player inline). Adicionamos uma camada de transcrição de plataforma (Groq primário / OpenAI fallback) chamada dentro de `ingestInboundMedia`. Quando a transcrição funciona, a `Message(INBOUND)` guarda **os dois**: `mediaPath` (player do operador) **e** `content` = transcrição (contexto da IA), e o inbound passa a **agendar uma resposta da IA** como se fosse texto. Áudio longo é barrado por duração antes de transcrever; a chave usada é sempre a do sistema.

**Tech Stack:** Next.js/TypeScript, Prisma/Postgres, Baileys, SDK `openai` (já é dependência — reaproveitado apontando para o endpoint OpenAI-compatível da Groq), Vitest.

---

## Decisões de design (contexto para quem implementa)

1. **Provider único de plataforma.** Transcrição roda *antes* do LLM de conversa e não passa por `resolveProviderForUser`. A chave é sempre do sistema (BYOK não se aplica: Anthropic não transcreve). Groq (`whisper-large-v3-turbo`) primário pelo custo/latência; OpenAI (`whisper-1`) fallback usando a `OPENAI_API_KEY` que já existe.

2. **Crédito NÃO muda.** Um áudio dispara exatamente **uma** resposta da IA, igual a texto. O custo dominante (a resposta do LLM) é idêntico; a transcrição é ~6% do valor de 1 crédito. Continuamos chamando `consumeAiCredit` uma vez por resposta, sem peso novo. (Teto mensal de minutos por plano = fase futura, só se dados mostrarem abuso — ver Fase 5.)

3. **Áudios longos (proteção da chave do sistema), em 3 camadas:**
   - Teto de download de 25 MB já existe em `pool.ts` (≈25–40 min de opus) → nada maior que o limite do transcritor chega nele.
   - Teto de **duração** `TRANSCRIBE_MAX_SECONDS` (default 300s): lido de `audioMessage.seconds` **antes** de transcrever. Acima → **não transcreve e mantém o comportamento atual: player para o operador + aviso "só leio texto" ao lead** (decisão fechada — sem mensagem nova). A IA não é acionada.
   - Truncagem do transcrito injetado na IA (`TRANSCRIBE_MAX_CHARS`, default 1200) — protege a janela de contexto e o custo de TODAS as respostas seguintes.

4. **Falha nunca quebra o inbound.** `transcribeAudio` retorna `null` em qualquer erro; o áudio segue como hoje (placeholder + player + aviso).

5. **Feature flag** `TRANSCRIBE_ENABLED` (default `false`) para subir escuro e ligar quando validado.

---

## Fase 1 — Módulo de transcrição (isolado e testável)

### Task 1.1: Variáveis de ambiente

**Files:**
- Modify: `src/lib/env.ts` (adicionar ao schema zod, junto dos outros blocos)

**Step 1: Adicionar as chaves no schema** (seguindo o padrão zod já existente)

```ts
  // ── Transcrição de áudio (fala→texto) — chave SEMPRE de plataforma ──────────
  TRANSCRIBE_ENABLED: z.coerce.boolean().default(false),
  TRANSCRIBE_PROVIDER: z.enum(["groq", "openai"]).default("groq"),
  GROQ_API_KEY: z.string().optional().default(""),
  TRANSCRIBE_MODEL_GROQ: z.string().default("whisper-large-v3-turbo"),
  TRANSCRIBE_MODEL_OPENAI: z.string().default("whisper-1"),
  TRANSCRIBE_MAX_SECONDS: z.coerce.number().int().positive().default(300), // 5 min
  TRANSCRIBE_MAX_CHARS: z.coerce.number().int().positive().default(1200),  // truncagem p/ contexto da IA
```

**Step 2: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat(transcribe): variaveis de ambiente da transcricao de audio"
```

---

### Task 1.2: Guardrail puro de elegibilidade (TDD)

Função pura, sem I/O, que decide se um áudio deve ser transcrito. Fácil de testar — cobre o caso de áudio longo.

**Files:**
- Create: `src/server/ai/transcribe-policy.ts`
- Test: `src/server/ai/transcribe-policy.test.ts`

**Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { shouldTranscribe } from "./transcribe-policy";

describe("shouldTranscribe", () => {
  const cfg = { enabled: true, maxSeconds: 300 };

  it("transcreve áudio curto dentro do teto", () => {
    expect(shouldTranscribe({ seconds: 30 }, cfg)).toBe(true);
  });
  it("não transcreve com a feature desligada", () => {
    expect(shouldTranscribe({ seconds: 30 }, { ...cfg, enabled: false })).toBe(false);
  });
  it("não transcreve áudio acima do teto de duração", () => {
    expect(shouldTranscribe({ seconds: 600 }, cfg)).toBe(false);
  });
  it("transcreve quando a duração é desconhecida (deixa o teto de 25MB decidir)", () => {
    expect(shouldTranscribe({ seconds: undefined }, cfg)).toBe(true);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/ai/transcribe-policy.test.ts`
Expected: FAIL ("shouldTranscribe is not a function").

**Step 3: Implementar o mínimo**

```ts
/** Decisão pura: este áudio deve ir para a transcrição?
 *  - feature desligada → não.
 *  - duração conhecida e acima do teto → não (áudio longo; protege a chave do sistema).
 *  - duração desconhecida → sim (o teto de 25MB do download decide o limite real).
 */
export function shouldTranscribe(
  audio: { seconds?: number | null },
  cfg: { enabled: boolean; maxSeconds: number },
): boolean {
  if (!cfg.enabled) return false;
  if (typeof audio.seconds === "number" && audio.seconds > cfg.maxSeconds) return false;
  return true;
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/ai/transcribe-policy.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/ai/transcribe-policy.ts src/server/ai/transcribe-policy.test.ts
git commit -m "feat(transcribe): politica pura de elegibilidade (barra audio longo)"
```

---

### Task 1.3: Cliente de transcrição (Groq primário / OpenAI fallback)

**Files:**
- Create: `src/server/ai/transcribe.ts`

Reaproveita o SDK `openai` apontando o `baseURL` para a Groq (endpoint OpenAI-compatível). Nunca lança: erro → `null`.

**Step 1: Implementar**

```ts
import OpenAI, { toFile } from "openai";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/** Config resolvida do provider ativo (chave SEMPRE de plataforma). */
function resolveTranscribeClient():
  | { client: OpenAI; model: string }
  | null {
  if (env.TRANSCRIBE_PROVIDER === "groq") {
    if (!env.GROQ_API_KEY) return openaiFallback();
    return {
      client: new OpenAI({
        apiKey: env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      }),
      model: env.TRANSCRIBE_MODEL_GROQ,
    };
  }
  return openaiFallback();
}

function openaiFallback(): { client: OpenAI; model: string } | null {
  if (!env.OPENAI_API_KEY) return null;
  return {
    client: new OpenAI({ apiKey: env.OPENAI_API_KEY }),
    model: env.TRANSCRIBE_MODEL_OPENAI,
  };
}

/**
 * Transcreve um buffer de áudio (nota de voz do WhatsApp, geralmente ogg/opus).
 * Retorna o texto, ou `null` em qualquer falha/sem chave — o chamador segue com
 * o comportamento antigo (placeholder + player). Trunca em `TRANSCRIBE_MAX_CHARS`.
 */
export async function transcribeAudio(
  buffer: Buffer,
  mime: string,
): Promise<string | null> {
  const resolved = resolveTranscribeClient();
  if (!resolved) return null;
  // extensão a partir do mime; opus vem como "audio/ogg; codecs=opus"
  const ext = (mime.split("/")[1]?.split(/[;+]/)[0] || "ogg").toLowerCase();
  try {
    const file = await toFile(buffer, `audio.${ext}`, { type: mime.split(";")[0] });
    const res = await resolved.client.audio.transcriptions.create({
      file,
      model: resolved.model,
      language: "pt",
    });
    const text = (res.text ?? "").trim();
    if (!text) return null;
    return text.length > env.TRANSCRIBE_MAX_CHARS
      ? text.slice(0, env.TRANSCRIBE_MAX_CHARS) + "…"
      : text;
  } catch (err) {
    logger.warn({ err, provider: env.TRANSCRIBE_PROVIDER }, "[transcribe] falha na transcrição");
    return null;
  }
}
```

**Step 2: Verificar tipos/lint**

Run: `npx tsc --noEmit` e `npm run lint`
Expected: sem erros nos arquivos novos.

**Step 3: Commit**

```bash
git add src/server/ai/transcribe.ts
git commit -m "feat(transcribe): cliente de transcricao groq/openai (nunca lanca)"
```

---

## Fase 2 — Levar a duração do áudio até o serviço

Hoje `InboundMediaEvent` não carrega a duração. Precisamos dela para o guardrail de áudio longo.

### Task 2.1: Propagar `audioSeconds` no evento de mídia

**Files:**
- Modify: `src/server/whatsapp/baileys/pool.ts`
  - Interface `InboundMediaEvent` (~linha 42): adicionar `audioSeconds?: number | null`.
  - No ponto do download (~linha 307), extrair de `inner.audioMessage?.seconds` e incluir no `onInboundMedia({...})`.
- Modify: `src/server/whatsapp/mock.ts` e/ou `src/server/whatsapp/types.ts` se `InboundMediaEvent` for compartilhado (verificar antes; se for local ao pool, só o pool).

**Step 1: Adicionar o campo na interface**

```ts
export interface InboundMediaEvent {
  // ...campos existentes...
  audioSeconds?: number | null; // duração da nota de voz (guardrail de áudio longo)
}
```

**Step 2: Preencher no handler de mídia** (dentro do bloco `if (placeholder) {`)

```ts
const audioSeconds =
  (inner as any)?.audioMessage?.seconds ?? null;
await handlers.onInboundMedia?.({
  fromPhone: phone,
  placeholder,
  providerMessageId: m.key.id ?? null,
  whatsAppNumberId: numberId,
  audioSeconds,
  ...(file && dl ? { buffer: file, mediaType: dl.mediaType, mime: dl.mime, fileName: dl.fileName } : {}),
});
```

**Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 4: Commit**

```bash
git add src/server/whatsapp/baileys/pool.ts
git commit -m "feat(transcribe): propaga duracao do audio no evento de midia"
```

---

### Task 2.2: Enviar "só leio texto" só quando o áudio NÃO for transcrito

Hoje `pool.ts` chama `replyUnsupportedMedia` para **toda** mídia. Para áudio que **será** transcrito, isso é errado (o lead receberia "só leio texto" e depois a resposta da IA). Para áudio **longo** (acima do teto), ao contrário, queremos **manter** o "só leio texto" atual (decisão fechada). A `shouldTranscribe` decide os dois casos num lugar só — reusada aqui para o aviso ficar consistente com o que o serviço vai fazer.

**Files:**
- Modify: `src/server/whatsapp/baileys/pool.ts` (bloco de mídia, ~linha 323)

**Step 1: Condicionar o aviso pela mesma política do serviço**

```ts
import { env } from "@/lib/env"; // já importado
import { shouldTranscribe } from "@/server/ai/transcribe-policy";

// ...dentro do if (placeholder), DEPOIS do onInboundMedia:
const isAudio = dl?.mediaType === "audio";
const willTranscribe =
  isAudio &&
  !!file &&
  shouldTranscribe(
    { seconds: audioSeconds },
    { enabled: env.TRANSCRIBE_ENABLED, maxSeconds: env.TRANSCRIBE_MAX_SECONDS },
  );
// Áudio curto elegível → não avisa (a IA vai responder). Áudio longo ou não
// transcritível → mantém o "só leio texto" de sempre.
if (!willTranscribe) {
  await replyUnsupportedMedia(numberId, phone, rec.label);
}
```

> `shouldTranscribe` é fonte única da verdade: o mesmo predicado roda aqui (para decidir o aviso) e no serviço (para decidir transcrever). Áudio longo → `false` nos dois → "só leio texto" enviado e IA não acionada. Sem divergência possível.

**Step 2: Commit**

```bash
git add src/server/whatsapp/baileys/pool.ts
git commit -m "feat(transcribe): aviso 'so leio texto' so quando nao transcreve"
```

---

## Fase 3 — Transcrever no ingest e agendar a resposta da IA (o núcleo)

### Task 3.1: `ingestInboundMedia` transcreve e sinaliza resposta

Mudar a assinatura de retorno de `void` para o mesmo formato de `ingestInbound` (`{ respond, leadId, delayMs }`), transcrever quando elegível, e gravar a `Message` com `content` = transcrição **mantendo** `mediaPath` (player do operador).

**Files:**
- Modify: `src/server/services/conversation.service.ts` (`ingestInboundMedia`, linhas 179-246)

**Step 1: Aceitar a duração e retornar resultado**

```ts
export async function ingestInboundMedia(input: {
  phone?: string;
  whatsAppNumberId?: string;
  placeholder: string;
  providerMessageId: string | null;
  buffer?: Buffer;
  mediaType?: "image" | "audio" | "document";
  mime?: string;
  fileName?: string;
  audioSeconds?: number | null;
}): Promise<{ respond: boolean; leadId: string | null; delayMs: number }> {
```

**Step 2: Transcrever antes de criar a Message** (após resolver o lead e subir a mídia)

```ts
  // Áudio: se elegível, transcreve para texto e trata como inbound de texto.
  // Mantém mediaPath (player do operador) E content=transcrição (contexto da IA).
  let transcript: string | null = null;
  if (
    input.mediaType === "audio" &&
    input.buffer &&
    input.mime &&
    shouldTranscribe(
      { seconds: input.audioSeconds ?? null },
      { enabled: env.TRANSCRIBE_ENABLED, maxSeconds: env.TRANSCRIBE_MAX_SECONDS },
    )
  ) {
    transcript = await transcribeAudio(input.buffer, input.mime);
  }

  const content = transcript ?? input.placeholder;

  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "INBOUND",
      content, // transcrição quando houver; senão o placeholder "🎤 Áudio"
      providerMessageId: input.providerMessageId ?? undefined,
      ...(media ?? {}), // mediaPath/mediaType/mediaMime/fileName — player continua
    },
  });

  await invalidateConversation(lead.id);
  await invalidateLeadCaches(lead.userId);
  await reopenIfResolved(lead);

  // Sem transcrição → comportamento antigo (não aciona IA).
  if (!transcript) return { respond: false, leadId: lead.id, delayMs: 0 };

  // Com transcrição → segue a MESMA lógica de timing do texto (opt-out/billing já
  // não se aplicam aqui pois é conteúdo do lead; a resposta reusa respondToLead).
  const num = lead.whatsAppNumberId
    ? await prisma.whatsAppNumber.findUnique({
        where: { id: lead.whatsAppNumberId },
        select: { replyDelaySeconds: true, firstReplyDelaySeconds: true },
      })
    : null;
  const firstOutbound = await prisma.message.findFirst({
    where: { leadId: lead.id, direction: "OUTBOUND" },
    select: { id: true },
  });
  const seconds = firstOutbound
    ? num?.replyDelaySeconds ?? 0
    : num?.firstReplyDelaySeconds ?? 0;
  return { respond: true, leadId: lead.id, delayMs: Math.max(0, seconds) * 1000 };
```

> **DRY:** o cálculo de `delayMs` é idêntico ao final de `ingestInbound`. Se preferir, extrair um helper `suggestReplyDelay(lead)` e usar nos dois lugares — recomendado.

**Step 3: Imports no topo do arquivo**

```ts
import { transcribeAudio } from "@/server/ai/transcribe";
import { shouldTranscribe } from "@/server/ai/transcribe-policy";
import { env } from "@/lib/env";
```

**Step 4: Commit**

```bash
git add src/server/services/conversation.service.ts
git commit -m "feat(transcribe): ingestInboundMedia transcreve audio e agenda resposta"
```

---

> **Áudio longo:** decisão fechada — mantém o "só leio texto" atual, enviado pelo `pool.ts` (Task 2.2). O serviço apenas retorna `{ respond: false }` (transcript `null`), sem mensagem nova. Nenhuma tarefa extra necessária.

---

### Task 3.2: Worker agenda a resposta após transcrição

**Files:**
- Modify: `src/server/worker/run.ts` (handler `onInboundMedia`, linhas 66-81)

**Step 1: Agendar a resposta quando o ingest sinalizar**

```ts
    onInboundMedia: (e) =>
      ingestInboundMedia({
        phone: e.fromPhone,
        whatsAppNumberId: e.whatsAppNumberId,
        placeholder: e.placeholder,
        providerMessageId: e.providerMessageId,
        buffer: e.buffer,
        mediaType: e.mediaType,
        mime: e.mime,
        fileName: e.fileName,
        audioSeconds: e.audioSeconds,
      })
        .then((r) => {
          if (r.respond && r.leadId) scheduleResponse(r.leadId, r.delayMs);
        })
        .catch((err) => {
          logger.error(
            { whatsAppNumberId: e.whatsAppNumberId, fromPhone: e.fromPhone, err },
            "[worker] ingestInboundMedia falhou",
          );
        }),
```

**Step 2: Commit**

```bash
git add src/server/worker/run.ts
git commit -m "feat(transcribe): worker agenda resposta da IA apos transcricao"
```

---

## Fase 4 — Testes de integração e observabilidade

### Task 4.1: Teste do ingest com transcrição mockada

**Files:**
- Test: `src/server/services/conversation.media.test.ts` (novo) ou estender o teste existente do serviço.

**Step 1: Escrever o teste**

Mockar `@/server/ai/transcribe` (`transcribeAudio` → "quero agendar uma reunião") e verificar que `ingestInboundMedia` para um áudio de 30s:
- cria `Message` INBOUND com `content` = transcrição **e** `mediaPath` preenchido;
- retorna `{ respond: true, leadId }`.
E que para áudio de 600s (acima do teto): `content` = placeholder, `respond: false`, `transcribeAudio` **não** é chamado.

**Step 2: Rodar**

Run: `npx vitest run src/server/services/conversation.media.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/server/services/conversation.media.test.ts
git commit -m "test(transcribe): ingest de audio curto vs longo"
```

### Task 4.2: Log de custo/observabilidade

**Files:**
- Modify: `src/server/ai/transcribe.ts`

Logar (nível info) provider, modelo e duração aproximada por transcrição bem-sucedida, para acompanhar volume/custo em produção antes de decidir sobre a Fase 5. Commit.

### Task 4.3: Suite completa + smoke

Run: `npm test` (Expected: verde) e, se houver ambiente, `npm run smoke:atendimento` com um áudio real.

---

## Fase 5 — (FUTURO, só se necessário) Teto mensal de minutos por plano

Não implementar agora. Gatilho: os logs da Task 4.2 mostrarem contas com volume de áudio que comprometa margem. Desenho, quando for a hora:
- Espelhar o padrão de cota de IA: campos `audioSecMonth` / `audioSecUsed` no `User` (como `aiCreditMonth`/`aiCreditUsed`).
- Consumir em `ingestInboundMedia` antes de transcrever; acima do teto do plano → não transcreve, cai no "só leio texto" (mesmo caminho do áudio longo).
- Régua em `PLAN_LIMITS` (`src/lib/plans.ts`): ex. INICIAL 60 min, PROFISSIONAL 500 min, ESCALA 2000 min.

---

## Checklist de rollout

1. Deploy com `TRANSCRIBE_ENABLED=false` (nada muda).
2. Provisionar `GROQ_API_KEY` no serviço **worker** (`crm-teste`). Fallback OpenAI já tem chave.
3. Ligar `TRANSCRIBE_ENABLED=true` para um número de teste; enviar áudio curto e um > 5 min.
4. Conferir: áudio curto → IA responde ao conteúdo, player do operador presente; áudio longo (> 5 min) → "só leio texto" + player, IA não acionada.
5. Acompanhar logs da Task 4.2 por 1–2 semanas antes de decidir sobre a Fase 5.
