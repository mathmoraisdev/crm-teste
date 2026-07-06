# IA tool-calling — do orquestrador determinístico ao loop de tools

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 7, Onda E, Release 3).

**Goal:** hoje a IA responde num **funil determinístico** de branches fixos em
[`respondToLead`](../../src/server/services/conversation.service.ts#L498) — resposta a lembrete →
qualificação → oferta/agenda/descarte → atendimento livre. Cada capacidade nova exige um branch
novo. Este plano introduz um **loop de tools** que a IA aciona por decisão própria durante a
resposta de atendimento: consultar estoque ao vivo, enviar o catálogo, **abrir uma comanda pelo
chat**, mandar mídia e **escalar para um humano com motivo**. O funil determinístico continua de pé
como fallback; o loop **só liga atrás de uma flag por número**.

**Architecture:** o `AiClient` ([provider.ts](../../src/server/ai/provider.ts)) hoje só sabe
`generateText` (texto livre) e `forcedToolCall` (força **uma** tool → JSON, usado por qualificação
e escolha de slot). Falta o essencial de um agente: **múltiplas tools, `tool_choice: auto`, e o
feedback do resultado da tool de volta ao modelo em múltiplos passos**. Adicionamos um terceiro
método — `runToolLoop` — que orquestra esse ida-e-volta nos dois SDKs (OpenAI e Anthropic),
recebendo do chamador as **tools com seus handlers** e devolvendo o texto final + auditoria das
tools usadas. `forcedToolCall`/`generateText` ficam intactos (qualificação/slot não mudam).

No `respondToLead`, o **branch de atendimento (4d)** ganha um caminho alternativo: quando o número
tem `aiToolCallingEnabled`, em vez de `generateAttendanceReply` (uma geração de texto) roda
`generateAgenticReply` — o mesmo contexto de empresa, agora com as tools ligadas ao `lead`/conta.
Handlers são **closures sobre `{ lead, accountId, company }`** que chamam os serviços já existentes
(`order.service`, `catalog.service`, `setHandoff`, `sendWhatsAppMedia`). Tools com efeito colateral
(criar comanda, mandar mídia, escalar) executam **durante** o loop; o texto final é sanitizado e
enviado por `sendWhatsAppMessage`, igual hoje.

**Tech Stack:** Next.js (App Router) · Prisma · Postgres · Zod · OpenAI/Anthropic SDK · Vitest.

**Escopo (o que NÃO entra em v1):**
- **Fechar/cobrar comanda pelo chat** — `criar_comanda` só **abre** e adiciona itens (fica `ABERTA`);
  pagamento continua pelo fluxo de oferta/Pix ([sendOffer](../../src/server/services/sales.service.ts#L32))
  ou manual no caixa. Fechar via chat é follow-up (exige confirmação forte + POS financeiro no fluxo).
- **RAG do knowledgeBase** (7.6) — só esboço no fim; base grande é raro no MVP.
- **Áudio/voz gerada** — resposta segue texto. Mídia é só de saída (biblioteca de assets do operador).
- **Migrar o funil inteiro (qualificar/agendar/oferta) para tools** — entra por último (Fase 6),
  atrás da MESMA flag, com os evals como rede; o funil determinístico permanece como padrão.

**Decisões de produto:**
- **Opt-in por número** (`aiToolCallingEnabled`, default `false`) — igual ao padrão de
  `salesEnabled/qualifyEnabled/scheduleEnabled`. Número sem a flag roda **exatamente** o fluxo de
  hoje (byte-idêntico). Kill-switch global por env `AI_TOOLCALLING_DISABLED` p/ desligar tudo em prod.
- **Tools read-only primeiro** (consultar estoque, catálogo) → efeito colateral depois (comanda,
  mídia, escalar). Cada tool é uma fase entregável e reversível (basta não registrá-la).
- **Guardas de custo:** `maxSteps` (default 4) e `maxTokens` por passo; o loop nunca é infinito.
  Vigiar tokens ([[ai-context-and-media-policy]], [[pricing-plans-cost]]).
- **Anti-colisão preservada:** `aiStillActive` continua sendo checado **antes** do loop e **antes**
  do envio final; `escalar_humano` encerra o loop (`stop`) e pausa a IA.
- **`criar_comanda` é opt-in duplo:** só quando o número tem tool-calling **e** a conta usa o módulo
  de comanda (há `CatalogItem`s). Dinheiro em centavos, total derivado ([[caixa-despesas-reposicionamento]]).

---

## Coordenação (Onda E — compartilhada com a iniciativa 10, Automação de ciclo de vida)

- **Schema (Onda E):** este plano cria **`prisma/manual/2026-07-08-onda-e.sql`** (idempotente,
  `IF NOT EXISTS`) com o que a iniciativa 7 precisa:
  - `WhatsAppNumber.aiToolCallingEnabled Boolean` (a flag da Fase 2);
  - model `MediaAsset` (a biblioteca de mídia da Fase 5).
  A **iniciativa 10** (`2026-07-08-automacao-ciclo-vida.md`) **acrescenta** `Lead.lastEngagedAt` ao
  **mesmo** arquivo — não sobrescreva, compõe (igual estoque×despesas fizeram na Onda A).
- Regra de ouro da Onda ([[prod-schema-drift-destravar]]): em dev é `db push` (pare o `next dev` —
  [[prisma-generate-dev-server-lock]]); em PROD é **só** o `manual/*.sql` idempotente aplicado pelo
  dono no Supabase SQL Editor. **Nunca** rode SQL manual redundante com uma migration versionada.
- Sem sobreposição de arquivos de código com a iniciativa 10 (ela vive no worker; esta, no serviço
  de conversa e no provider de IA).

---

## Contexto do código existente (leia antes de começar)

- **Orquestrador:** [`respondToLead`](../../src/server/services/conversation.service.ts#L498) — o
  branch **4d** ([conversation.service.ts:667](../../src/server/services/conversation.service.ts#L667))
  chama `generateAttendanceReply` e depois `sendWhatsAppMessage`. É **aqui** que o caminho agêntico
  entra, gated pela flag. Note os rechecks `aiStillActive` (L685) — precisam sobreviver.
- **Provider de IA:** [provider.ts](../../src/server/ai/provider.ts) — `AiClient` com `generateText`
  e `forcedToolCall`. `pick(tier, model)` resolve o modelo (override → client → tier). Plataforma
  força tudo no econômico em [resolve.ts](../../src/server/ai/resolve.ts#L45) (`getAiClient`) — o
  loop herda isso (gpt-4o-mini/haiku suportam tool-calling).
- **Agente de atendimento:** [`generateAttendanceReply`](../../src/server/ai/conversation.agent.ts#L121)
  — monta `system` (override ou `ATTENDANCE_SYSTEM`), o bloco de contexto e o transcript, chama
  `generateText`, sanitiza (`stripMarkdownLinks`/`stripSpeakerLabel`). O caminho agêntico **espelha**
  a montagem de contexto e a sanitização — só troca `generateText` por `runToolLoop`.
- **Catálogo p/ IA:** [`renderCatalogForAI`](../../src/server/ai/attendance-context.ts#L58) — tem
  `limit=40` e **não expõe ids nem quantidade**. As tools de estoque/comanda precisam de um render
  **com id e saldo** (novo helper); a 7.3 "leitura ao vivo sem cap de 40" mora aqui.
- **Serviço de comanda:** [`openOrder`](../../src/server/services/order.service.ts#L81) (aceita
  `leadId`, `openedById`), [`addItem`](../../src/server/services/order.service.ts#L114) (por
  `catalogItemId` ou avulso). Total derivado; centavos.
- **Catálogo:** [`listCatalogItems`](../../src/server/services/catalog.service.ts#L76)
  `(accountId, { activeOnly })`.
- **Mídia de saída:** [`sendWhatsAppMedia`](../../src/server/services/messaging.ts#L154)
  `(lead, media & { buffer }, opts)` — precisa de `buffer` + `mediaPath`; baixa via
  [`downloadMediaBuffer`](../../src/server/storage/media-storage.ts#L81). **Não existe biblioteca de
  mídia hoje** — a Fase 5 cria `MediaAsset` (upload pelo operador, Settings) p/ a IA ter o que enviar.
- **Escalar p/ humano:** [`setHandoff`](../../src/server/services/conversation.service.ts#L817)
  `(leadId, userId, paused=true)` — já move p/ FILA + inicia SLA.
- **Toggles por número:** [WhatsAppNumber](../../prisma/schema.prisma#L950) já tem
  `autoReplyEnabled/qualifyEnabled/scheduleEnabled/salesEnabled` — a nova flag segue o padrão.
- **Rede de segurança:** [agents.eval.test.ts](../../src/server/ai/agents.eval.test.ts) — evals
  opt-in (`RUN_AI_EVALS=1` + `OPENAI_API_KEY`), asserção por decisão de negócio, não valor exato.
  **Toda fase que muda decisão da IA ganha um eval aqui.**

---

## Visão geral das fases

> **Ordem por risco, não pela numeração do mestre.** O mestre lista 7.1 (migrar funil p/ tools)
> primeiro, mas essa é a mudança **mais arriscada**; construímos a infra e as tools novas de baixo
> risco antes, e deixamos a migração do funil por último (o próprio mestre manda "fazer atrás de
> flag, com `agents.eval.test.ts` como rede"). Cada fase é entregável sozinha.

- **Fase 1** — Motor `runToolLoop` no provider (infra pura; TDD com AiClient fake). Nada em prod ainda.
- **Fase 2** — Caminho agêntico atrás da flag `aiToolCallingEnabled` + tools **read-only**:
  `consultar_estoque` (7.3) e `enviar_catalogo`. Flag off = fluxo de hoje idêntico.
- **Fase 3** — Tool `criar_comanda` (7.4) — abre comanda + itens (depende do POS financeiro). Guards.
- **Fase 4** — Tool `escalar_humano` (7.5) — a IA decide mandar p/ a fila com motivo.
- **Fase 5** — Tool `enviar_midia` (7.2) + biblioteca `MediaAsset` (schema opcional da Onda E).
- **Fase 6** — Migrar `qualificar`/`agendar`/`enviar_oferta` para tools (7.1) — a mais arriscada.
- **Fase 7** — (esboço) RAG do knowledgeBase (7.6) — fora do v1.

---

# FASE 1 — Motor de tool-loop no provider

Objetivo: dar ao `AiClient` a capacidade de rodar **N passos** de tool-calling. Sem tocar em nada de
produção — só a infra e seus testes. Os handlers das tools são fornecidos pelo **chamador**; o
provider só orquestra os round-trips com cada SDK.

## Task 1.1: Tipos + método `runToolLoop` na interface `AiClient` — TDD
**Files:** Modify `src/server/ai/provider.ts`; Test `src/server/ai/provider.tool-loop.test.ts`.

- Novos tipos (exportados de `provider.ts`):
```ts
export interface ToolResult { content: string; stop?: boolean } // content = resultado devolvido ao modelo
export interface ToolDef {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<ToolResult>;
}
export interface LoopMessage { role: "user" | "assistant"; content: string }
export interface RunToolLoopOpts {
  tier: Tier; system: string; messages: LoopMessage[]; tools: ToolDef[];
  maxTokens: number; maxSteps?: number; model?: string; // maxSteps default 4
}
export interface RunToolLoopResult { text: string; toolsUsed: string[]; stopped: boolean }
```
- Acrescente `runToolLoop(opts: RunToolLoopOpts): Promise<RunToolLoopResult>` à interface `AiClient`.
- **Test (falha primeiro)** — usa um **AiClient fake** (não o SDK real): implementa `runToolLoop`
  chamando os handlers passados numa sequência roteirizada. Verifica o *contrato* do resultado:
  handler que devolve `stop:true` → `stopped:true` e `toolsUsed` inclui a tool; texto final propagado.
  *(Este teste fixa a forma que o resto do plano consome; a impl real dos SDKs é 1.2/1.3.)*

## Task 1.2: Implementação OpenAI de `runToolLoop`
**Files:** Modify `src/server/ai/provider.ts` (`openAiClient`).
- Monta `messages = [{role:system}, ...opts.messages]`. Loop até `maxSteps`:
  `chat.completions.create({ model: pick(tier,model), tools, tool_choice: "auto", messages })`.
  - Sem `tool_calls` → devolve `{ text: content.trim(), toolsUsed, stopped:false }`.
  - Com `tool_calls`: push da `assistant` message (com os `tool_calls`); p/ cada call, `JSON.parse`
    dos args (falha → `ToolResult` de erro amigável), roda `handler`, push `{role:"tool",
    tool_call_id, content}`; registra o nome em `toolsUsed`. Se algum handler devolve `stop:true`,
    encerra o loop → `{ text:"", toolsUsed, stopped:true }` (a tool já produziu o efeito/mensagem).
  - Estourou `maxSteps` → devolve o último texto (ou `""`). Commit.

## Task 1.3: Implementação Anthropic de `runToolLoop`
**Files:** Modify `src/server/ai/provider.ts` (`anthropicClient`).
- Espelha 1.2 com blocos de conteúdo: `messages.create({ tools, ... })`; percorre `content` — bloco
  `text` acumula resposta, bloco `tool_use` roda o handler e vira um `tool_result`
  (`{ type:"tool_result", tool_use_id, content }`) na próxima mensagem `user`. `stop_reason ==
  "tool_use"` continua o loop; senão devolve o texto. `stop:true` de um handler encerra igual. Commit.

## Task 1.4: Fake `AiClient` de teste reutilizável
**Files:** Create `src/server/ai/testing/fake-ai-client.ts`.
- `makeScriptedToolLoopClient(script: { call: string; args: unknown }[])` — um `AiClient` cujo
  `runToolLoop` executa **os handlers reais** passados pelo chamador, na ordem do `script`, e devolve
  um texto fixo no fim (ou `stopped` se um handler pediu). `generateText`/`forcedToolCall` lançam
  "não usado no teste". Isto permite testar o **wiring da camada de conversa e os handlers** de forma
  **determinística**, sem tocar na OpenAI. Commit.

> **Fim da Fase 1:** o provider sabe rodar tools, com testes verdes e **zero** impacto em produção
> (nada chama `runToolLoop` ainda). `npx tsc --noEmit` + `npx vitest run src/server/ai/provider*`.

---

# FASE 2 — Caminho agêntico atrás da flag + tools read-only

## Task 2.1: Flag `aiToolCallingEnabled` no schema (Onda E)
**Files:** Modify `prisma/schema.prisma` (`WhatsAppNumber`); Create `prisma/manual/2026-07-08-onda-e.sql`.
- Em `WhatsAppNumber`, ao lado de `salesEnabled`: `aiToolCallingEnabled Boolean @default(false)`.
- `db push` em dev (pare o `next dev`). Crie o `onda-e.sql` idempotente (a iniciativa 10 vai
  **acrescentar** aqui — deixe um comentário de cabeçalho dizendo isso):
```sql
-- Onda E (idempotente). Iniciativa 7 (IA tool-calling): flag + biblioteca de mídia.
-- Iniciativa 10 (automação) ACRESCENTA Lead.lastEngagedAt neste mesmo arquivo — não sobrescreva.
ALTER TABLE "WhatsAppNumber" ADD COLUMN IF NOT EXISTS "aiToolCallingEnabled" BOOLEAN NOT NULL DEFAULT false;
```
- Kill-switch global: adicione `AI_TOOLCALLING_DISABLED: z.coerce.boolean().default(false)` em
  [env.ts](../../src/lib/env.ts). Commit.

## Task 2.2: Render de catálogo COM id e saldo p/ tools — TDD
**Files:** Modify `src/server/ai/attendance-context.ts`; Test `attendance-context.test.ts`.
- **Contexto:** `renderCatalogForAI` não expõe id (a IA não consegue referenciar item p/ comanda) e
  corta em 40. As tools precisam de outra visão.
- Novo `renderCatalogForTools(items: { id; name; priceCents; kind; trackStock?; stockQty? }[]): string`
  — **sem cap**, uma linha por item `id=<id> | <nome> | <preço|sob consulta> | estoque=<n|—>`.
  Marca `INDISPONÍVEL` quando `trackStock && stockQty<=0`. Vazio → `""`.
- Test: item com id/preço/estoque aparece com o id; item sem preço = "sob consulta"; sem estoque =
  INDISPONÍVEL; lista de 60 itens não é truncada. Commit.

## Task 2.3: Tools read-only + `buildAttendanceTools` — TDD
**Files:** Create `src/server/ai/tools/attendance-tools.ts`; Test `attendance-tools.test.ts`.
- `buildAttendanceTools(ctx): ToolDef[]` — fábrica que decide **internamente** quais tools registrar a
  partir do contexto. Assinatura do ctx (fixada aqui; fases seguintes só populam mais flags, sem mudar
  a forma):
```ts
interface AttendanceToolCtx {
  lead: { id: string; phone: string; userId: string; whatsAppNumberId: string | null; name: string };
  accountId: string;              // = lead.userId (tenantUserId)
  company: { salesEnabled?: boolean; scheduleEnabled?: boolean; qualifyEnabled?: boolean } | null;
  hasCatalog: boolean;            // conta tem CatalogItem ativo (habilita criar_comanda — Fase 3)
  hasMedia: boolean;              // conta tem MediaAsset (habilita enviar_midia — Fase 5); false por ora
}
```
  Nesta fase a fábrica devolve **sempre** duas tools (não dependem de flag):
  - **`consultar_estoque`** — args `{ query?: string }`. Handler chama `listCatalogItems(accountId,
    {activeOnly:true})`, filtra por `query` (nome, case-insensitive) quando dado, e devolve
    `renderCatalogForTools(...)` como `content`. Sem efeito colateral. Resolve a 7.3 (leitura ao vivo,
    sem cap de 40).
  - **`enviar_catalogo`** — args `{}`. Handler monta o catálogo **voltado ao cliente** (texto WhatsApp,
    sem ids: nome + preço) e envia por `sendWhatsAppMessage(lead, texto)`; devolve `content:"catálogo
    enviado"` + **não** `stop` (a IA pode complementar). *(Sem mídia ainda; a versão em PDF/imagem é a
    Fase 5.)*
- Test com **stubs dos serviços** (mock de `listCatalogItems`/`sendWhatsAppMessage`): `consultar_estoque`
  devolve o render esperado e não envia nada; `enviar_catalogo` chama `sendWhatsAppMessage` uma vez.
  Commit.

## Task 2.4: `generateAgenticReply` no agente de conversa — TDD
**Files:** Modify `src/server/ai/conversation.agent.ts`; Test `conversation.agent.tool-loop.test.ts`.
- Novo `generateAgenticReply(opts)` — **mesma assinatura** de `generateAttendanceReply` + um campo
  `tools: ToolDef[]`. Reaproveita a montagem de `system`/`context`/`catalog`/`extra` (extraia o trecho
  comum num helper `buildAttendancePrompt(opts)` p/ não duplicar). Converte `conversation` em
  `LoopMessage[]` (INBOUND→`user`, OUTBOUND→`assistant`), chama `ai.runToolLoop({ tier:"cheap",
  maxTokens:700, maxSteps:4, system, messages, tools })`, sanitiza `result.text` igual hoje. Devolve
  `{ text, toolsUsed, stopped }`.
- Test com o fake client (1.4): script que chama `consultar_estoque` e depois responde → `text`
  sanitizado + `toolsUsed:["consultar_estoque"]`. Sem tools no script → comporta como uma resposta
  simples. Commit.

## Task 2.5: Ligar o caminho agêntico no `respondToLead` (gated) — TDD
**Files:** Modify `src/server/services/conversation.service.ts` (branch 4d).
- Carregue `aiToolCallingEnabled` no `select` da `company`
  ([conversation.service.ts:582](../../src/server/services/conversation.service.ts#L582), ao lado de
  `salesEnabled`). `hasCatalog` sai do `loadCatalogBlock`/`listCatalogItems` já chamado no 4d (não
  duplique a query — derive do resultado). No 4d:
```ts
const toolsOn = !env.AI_TOOLCALLING_DISABLED && (company?.aiToolCallingEnabled ?? false);
if (toolsOn) {
  const tools = buildAttendanceTools({
    lead, accountId: lead.userId, company,
    hasCatalog, hasMedia: false, // hasMedia liga na Fase 5
  });
  const r = await generateAgenticReply({ ai, company: {/* mesma flatten de 4d */}, catalogBlock, conversation, tools });
  if (!(await aiStillActive(lead.id))) return;      // recheck preservado
  if (r.stopped) return;                             // uma tool já encerrou o turno (ex.: escalar)
  if (r.text) await sendWhatsAppMessage(lead, r.text);
} else {
  /* caminho de hoje: generateAttendanceReply + send (inalterado) */
}
```
- **Test determinístico** (fake client + prisma de teste): número **sem** a flag → caminho antigo,
  byte-idêntico; número **com** a flag e script `consultar_estoque` → responde usando o resultado da
  tool. `aiStillActive=false` no recheck → não envia. Commit.

## Task 2.6: UI — toggle da flag nas Configurações do número
**Files:** Modify `src/components/WhatsAppNumbersPanel.tsx` + `src/app/api/numbers/[id]/route.ts`.
- Adicione `aiToolCallingEnabled` ao schema zod do PATCH em `numbers/[id]/route.ts` (ao lado de
  `salesEnabled`) e um switch "IA com ações (beta)" no painel, perto de "Modo vendas", persistindo a
  flag. Texto curto: "a IA pode consultar estoque, enviar catálogo e abrir comandas pelo chat".
  Verificação visual + commit.

## Task 2.7: Eval comportamental — roteamento de tool
**Files:** Modify `src/server/ai/agents.eval.test.ts`.
- Bloco `describe.skipIf(!enabled)("eval: attendance tool-calling")` com um AiClient real e um catálogo
  fake pequeno: "quanto tá o corte?" → a IA chama `consultar_estoque` (ou responde do catálogo);
  "me manda o cardápio" → `enviar_catalogo`. Asserção por **tool chamada** (via `toolsUsed`), não texto.
  Commit.

> **Fim da Fase 2:** um número beta responde consultando estoque ao vivo e mandando o catálogo, sem
> nenhum branch novo; todos os outros números seguem idênticos.

---

# FASE 3 — Tool `criar_comanda` (depende do POS financeiro)

## Task 3.1: Handler `criar_comanda` — TDD
**Files:** Modify `src/server/ai/tools/attendance-tools.ts`; Test `attendance-tools.test.ts`.
- Args: `{ itens: { catalogItemId: string; quantidade?: number }[] }` (a IA referencia itens pelo id
  que viu em `consultar_estoque`). Handler:
  1. **Idempotência (decisão firme):** reusa a comanda `ABERTA` mais recente do lead se houver
     (`listOpenOrders(accountId)` filtrado por `leadId`) — evita abrir duas comandas quando a IA chama
     a tool duas vezes no mesmo turno. Só abre via `openOrder(accountId, { openedById: accountId,
     leadId: lead.id })` quando o lead não tem comanda aberta;
  2. p/ cada item, `addItem(accountId, order.id, { catalogItemId, quantity })` (valida posse/preço no
     serviço; centavos e total derivado ficam no `order.service`);
  3. devolve `content` = resumo ("Comanda aberta: 2× X-Burguer, 1× Coca — total R$…"; **sem "#nº"** —
     o número do cupom só é atribuído no fechamento) p/ a IA confirmar ao cliente. **Não fecha**
     (pagamento fora do escopo v1). Sem `stop`.
- Guardas: id inexistente/da outra conta → `addItem` lança; capture e devolva `ToolResult` de erro
  amigável ("não encontrei esse item") em vez de estourar o loop. Sem `CatalogItem` na conta → a tool
  nem é registrada (a fábrica checa `hasCatalog` — Task 2.3).
- Test (stubs de `listOpenOrders`/`openOrder`/`addItem`): lead sem comanda → 1 `openOrder` + 2 `addItem`;
  lead com comanda aberta → **0** `openOrder`, itens vão na existente; resumo com o total; id inválido →
  mensagem de erro, sem crash. Commit.

## Task 3.2: Registrar a tool no gating + eval
**Files:** Modify `attendance-tools.ts` (habilita `criar_comanda` só se a conta tem catálogo);
Modify `agents.eval.test.ts`.
- Eval: "anota 2 x-burguer e uma coca" com catálogo fake → a IA chama `criar_comanda` com os ids
  certos. Asserção por tool + args. Commit.

## Task 3.3: Verificação E2E (mock WhatsApp)
- Via a rota de dev (simulate-reply), num número com a flag: "quero 2 coxinhas" → a IA abre a comanda;
  conferir no módulo Vendas que a comanda `ABERTA` apareceu com os itens/total certos. Commit.

---

# FASE 4 — Tool `escalar_humano`

## Task 4.1: Handler `escalar_humano` — TDD
**Files:** Modify `src/server/ai/tools/attendance-tools.ts`; Test `attendance-tools.test.ts`.
- Args: `{ motivo: string }`. Handler chama `setHandoff(lead.id, accountId, true)` (move p/ FILA +
  SLA), opcionalmente registra o motivo (nota interna se a iniciativa 6 já entregou `InternalNote`;
  senão, `console`/campo de auditoria simples). Devolve `content:"escalado"` **com `stop:true`** — o
  turno encerra sem a IA mandar mais nada (o humano assume). Sem enviar mensagem automática ao cliente
  (evita "vou te transferir" fantasma; decisão de produto — a IA pode avisar ANTES de chamar a tool).
- Test: chama `setHandoff` com `paused=true`, resultado `stopped`. Commit.

## Task 4.2: `stopped` encerra o turno no orquestrador
**Files:** já coberto em 2.5 (`if (r.stopped) return;`) — adicione teste específico: script que chama
`escalar_humano` → `respondToLead` não envia texto e o lead fica `aiPaused/FILA`. Commit.

## Task 4.3: Eval
**Files:** Modify `agents.eval.test.ts`.
- "quero falar com um atendente de verdade" / "isso é uma reclamação séria" → a IA chama
  `escalar_humano`. Commit.

---

# FASE 5 — Tool `enviar_midia` + biblioteca `MediaAsset`

> **Por que schema:** `sendWhatsAppMedia` exige um arquivo; **não há** biblioteca de mídia hoje. Sem
> uma fonte de assets, `enviar_midia` não tem o que enviar. `MediaAsset` é o único model novo da Onda
> E na iniciativa 7 (e é **opcional** — se a conta não subiu nada, a tool não é registrada).

## Task 5.1: Model `MediaAsset` (Onda E)
**Files:** Modify `prisma/schema.prisma`; append `prisma/manual/2026-07-08-onda-e.sql`.
```prisma
model MediaAsset {
  id         String   @id @default(cuid())
  account    User     @relation(fields: [accountId], references: [id], onDelete: Cascade)
  accountId  String
  label      String   // nome pesquisável ("cardápio", "tabela de preços")
  mediaPath  String   // caminho no Supabase Storage (assinado sob demanda)
  mediaType  String   // "image" | "document"
  mediaMime  String
  fileName   String?
  createdAt  DateTime @default(now())
  @@index([accountId])
}
```
- Relação inversa `mediaAssets MediaAsset[]` no `User`. `db push` dev. **Append** idempotente ao
  `onda-e.sql` (`CREATE TABLE IF NOT EXISTS "MediaAsset" (...)` + índice). `npx prisma validate`. Commit.

## Task 5.2: Serviço `media-asset.service` + upload — TDD
**Files:** Create `src/server/services/media-asset.service.ts`; Test correspondente.
- `listMediaAssets(accountId)`, `createMediaAsset(accountId, { label, buffer, mime, ... })` (usa o
  uploader de storage existente), `deleteMediaAsset(accountId, id)`. Escopado por conta. Test do CRUD.
  Commit.

## Task 5.3: Handler `enviar_midia` — TDD
**Files:** Modify `src/server/ai/tools/attendance-tools.ts`; Test.
- Args: `{ assetId: string }` (a IA escolhe entre a lista injetada no prompt, igual ofertas). Handler:
  `downloadMediaBuffer(asset.mediaPath)` → `sendWhatsAppMedia(lead, { ...asset, buffer })`; devolve
  `content:"mídia enviada"`. Asset de outra conta / download falho → `ToolResult` de erro amigável.
- A lista de assets disponíveis entra no `system`/contexto do loop (novo bloco em `buildAttendancePrompt`
  quando `enviar_midia` está habilitada) p/ a IA saber os `assetId`. Test com stubs. Commit.

## Task 5.4: UI — biblioteca de mídia nas Configurações
**Files:** nova seção "Mídias" (ex.: em `src/components/WhatsAppNumbersPanel.tsx` ou uma página de
conta) + nova rota `src/app/api/media-assets/route.ts` (GET/POST) e `.../[id]/route.ts` (DELETE),
espelhando o padrão de `numbers/[id]` (force-dynamic, `getTenantContext`, 401, zod, try/catch).
- Upload + lista + excluir, escopado por conta. Ao ligar `enviar_midia`, popular `hasMedia` no ctx da
  Task 2.5 (`listMediaAssets(accountId).length > 0`). Verificação visual + commit.

---

# FASE 6 — Migrar o funil determinístico para tools (a mais arriscada)

> Só depois das Fases 1–5 estáveis em beta. Objetivo da 7.1: **sem mudar comportamento**, expor
> `qualificar`/`agendar`/`enviar_oferta` como tools que a IA aciona, aposentando os branches fixos
> **para números com a flag**. O funil determinístico continua sendo o padrão (flag off) e o fallback.
>
> **Cuidado de interação (crítico p/ não disparar em dobro):** o caminho agêntico vive no branch **4d**,
> que só roda **depois** de 4a (qualificação) e 4c (agenda) terem passado sem desviar o fluxo — quando a
> qualificação determinística já decide `shouldSchedule`/`shouldOffer`, ela chama `proposeSlots`/
> `sendOffer` e **retorna antes** do 4d. Portanto as tools `agendar`/`enviar_oferta` só fazem sentido em
> números que **não** usam o funil de qualificação (`qualifyEnabled=false`) mas ainda querem agendar/
> ofertar por decisão da IA no atendimento. Em número com `qualifyEnabled=true`, **não registre** essas
> duas tools (a fábrica já checa `company`) — senão a mesma ação pode sair pelos dois caminhos.

## Task 6.1: Tools `agendar` e `enviar_oferta` — TDD
**Files:** Modify `src/server/ai/tools/attendance-tools.ts`; Test.
- `agendar` → handler chama `proposeSlots(lead.id)` (retorna `stop:true`: o subfluxo PROPOSED assume).
- `enviar_oferta` → args `{ offerId }` (da lista de ofertas ativas já injetada no prompt); handler chama
  `sendOffer(lead, offerId)` (`stop:true` quando `.sent`). A fábrica só registra `agendar` quando
  `scheduleEnabled && !qualifyEnabled`, e `enviar_oferta` quando `salesEnabled && !qualifyEnabled` — ver
  o "Cuidado de interação" acima (evita disparo duplo com o funil determinístico). Test com stubs
  cobrindo os dois gates. Commit.

## Task 6.2: Eval de paridade com o funil determinístico
**Files:** Modify `agents.eval.test.ts`.
- Reusa os cenários do eval de qualificação (lead quente → agenda/oferta; sem interesse → nada) e
  verifica que a **via agêntica** chama a tool equivalente. Compara a **decisão**, não o texto. Commit.

## Task 6.3: Decisão de rollout
- Manter `qualificar` como tool é **opcional** e caro (roda o modelo strong). Decisão registrada aqui:
  em v1 a qualificação/score **continua determinística** (roda antes, como hoje) mesmo com a flag; só
  `agendar`/`enviar_oferta`/estoque/comanda/mídia/escalar viram tools. Revisar após medir tokens
  ([[pricing-plans-cost]]). Commit da nota no plano.

  **✅ DECISÃO CONFIRMADA (2026-07-06):** `qualificar` **NÃO** vira tool em v1. Consequência de
  implementação: `agendar`/`enviar_oferta` só são registradas em número com **`qualifyEnabled=false`**
  (ver o gating em `buildAttendanceTools` + o carregamento de ofertas em `respondToLead` 4d). Em número
  com o funil ligado (`qualifyEnabled=true`), a qualificação determinística roda ANTES do branch 4d e é
  a única a chamar `proposeSlots`/`sendOffer` — as tools não são registradas ali, então não há disparo
  duplo. Reavaliar migrar `qualificar` p/ tool só depois de medir tokens em beta.

---

# FASE 7 — (esboço) RAG do knowledgeBase (7.6)

Fora do v1. Quando uma conta tiver base grande demais p/ o prompt: indexar `knowledgeBase` em chunks +
uma tool `buscar_conhecimento(query)` que devolve os trechos relevantes. Requer store de embeddings
(pgvector) — nova onda de schema. Só quando houver demanda real; hoje a base cabe no prompt.

---

## Verificação de ponta a ponta

1. Número **sem** a flag: conversa normal responde igual (nenhuma regressão) — smoke via simulate-reply.
2. Número **com** a flag: "quanto custa X?" → a IA consulta o catálogo; "manda o cardápio" → catálogo
   enviado; "quero 2 X" → comanda `ABERTA` criada no módulo Vendas; "quero um atendente" → lead vai p/
   FILA (`aiPaused`), sem resposta automática por cima.
3. `enviar_midia`: sobe um PDF em Mídias, "me manda a tabela de preços" → PDF chega ao lead (mock/prod).
4. Anti-colisão: operador assume durante a geração → o loop não envia por cima (`aiStillActive`).
5. Custo: um turno com 1–2 tools não passa de `maxSteps`; conferir nos logs de tokens.
6. `npx vitest run src/server/ai/ src/server/services/conversation*` verde + `npx tsc --noEmit`.
7. **Evals** (manual, opt-in): `RUN_AI_EVALS=1 OPENAI_API_KEY=… npm test -- src/server/ai/agents.eval.test.ts`.
8. PROD: aplicar `2026-07-08-onda-e.sql` no Supabase; deploy via CLI ([[vercel-hobby-push-block]]);
   worker no Oracle por `git pull` + restart ([[worker-oracle-update-procedure]]); ligar a flag em **um**
   número de teste antes de abrir p/ clientes.

---

## Riscos e notas

- **Refatoração do orquestrador é a mais arriscada do roadmap** — por isso tudo atrás de
  `aiToolCallingEnabled` (default off) + kill-switch `AI_TOOLCALLING_DISABLED`, e o funil determinístico
  permanece intacto no caminho não-flagado. Os evals de `agents.eval.test.ts` são a rede.
- **Custo de token** — o loop faz N chamadas por turno. `maxSteps=4`, `maxTokens` apertado, e o
  render de estoque só quando a tool é chamada (não sempre no prompt). Vigiar
  ([[ai-context-and-media-policy]], [[pricing-plans-cost]]). BYOK não pesa na nossa chave.
- **Modelo econômico na chave da plataforma** — `getAiClient` força cheap (gpt-4o-mini). Ele suporta
  tool-calling, mas é menos confiável que o strong em decisões finas; por isso `criar_comanda` referencia
  itens por **id** (não por nome livre) e os handlers **validam tudo no serviço** (posse, preço, estoque).
- **Efeito colateral mid-loop** — tools que criam comanda/mandam mídia/escalam agem **antes** do texto
  final. Se o operador assumir no meio, o recheck final barra o texto, mas o efeito já ocorreu; aceitável
  (abrir comanda / mandar catálogo são reversíveis/benignos; `escalar` já é o handoff desejado).
- **Idempotência de `criar_comanda`** — se a IA chamar a tool duas vezes no mesmo turno (alucinação),
  abririam-se duas comandas. **Resolvido na Task 3.1:** o handler reusa a comanda `ABERTA` mais recente
  do lead (`listOpenOrders` por `leadId`) e só abre nova quando não há nenhuma.
- **Onda E compartilhada com a iniciativa 10** — respeitar o append no `onda-e.sql`
  ([[prod-schema-drift-destravar]]); nunca duplicar manual×migration.
- **`MediaAsset` precisa de Storage** — sem Supabase Storage no dev local ([[local-dev-db-docker]]), a
  Fase 5 só é verificável ponta-a-ponta em prod; testar o serviço com o uploader mockado.
