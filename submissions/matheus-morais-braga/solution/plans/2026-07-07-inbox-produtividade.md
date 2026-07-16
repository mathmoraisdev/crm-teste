# Inbox produtivo — respostas rápidas + SLA real + notas internas / anti-colisão

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 6, Onda D).

**Goal:** o atendente humano hoje digita tudo do zero, não há meta de resposta, e dois operadores
podem responder o mesmo cliente sem saber. Este plano fecha os três maiores gaps de produtividade do
multiatendimento: **respostas rápidas** (snippets com variáveis e atalho `/`), **SLA real** (meta,
destaque de estouro na fila, tempo de 1ª resposta) e **notas internas + anti-colisão** (nota de
operador na conversa + indicador "fulano está atendendo/vendo").

**Architecture:** dois models novos por conta — `QuickReply` (título, corpo, atalho) e `InternalNote`
(nota de operador ligada ao lead, nunca enviada ao cliente). O **SLA reusa dados que já existem**
(`Lead.queuedAt`/`firstResponseAt`) — só adiciona uma **meta** (`User.inboxSlaMinutes` no dono) e o
cálculo puro de estouro. A **anti-colisão** usa o SSE já existente (`useTenantStream`/event bus):
quando um operador abre uma conversa, publica presença; a lista/cabeçalho mostra quem está lá. Reusa
`inbox.service`, `ConversationView`, `InboxView` e o barramento de eventos.

**Tech Stack:** Next.js (App Router) · Prisma · Postgres · Zod · TailwindCSS · Vitest · SSE
(`src/server/events`) · Redis (presença efêmera — [[crm-inbox-db-push-pending]]).

**Escopo (o que NÃO entra):** roteamento automático (rodízio/menos-ocupado = melhoria futura da
atribuição); relatório histórico de SLA com gráficos (v1 = meta + destaque ao vivo + coluna de tempo);
@menção com notificação push (v1 = nota simples, @menção textual sem push).

**Decisões de produto:**
- **Respostas rápidas por conta** (compartilhadas pela equipe), com variáveis `{{nome}}` resolvidas na
  inserção. Atalho `/` na caixa de resposta.
- **SLA é do dono** (`inboxSlaMinutes`), aplicado à conta toda. Estouro = `now - queuedAt > meta` e
  ainda sem `firstResponseAt`. Só destaque visual + coluna — não dispara ação automática (v1).
- **Nota interna nunca vira mensagem** — armazenamento e render separados do histórico de WhatsApp.
- **Anti-colisão é informativa** (não trava): mostra quem está na conversa; não impede responder.

---

## Coordenação (Onda D — Inbox; pode rodar em paralelo com Agenda/Onda C)

- **`prisma/schema.prisma`** + **novo `prisma/manual/2026-07-07-onda-d.sql`** — só esta iniciativa toca
  a Onda D. (Verticais unificadas, iniciativa 11, também é Onda D mas não mexe em schema.) `npx prisma
  validate` após as mudanças.
- Independe de Agenda e da Release 1.

---

## Contexto do código existente (leia antes de começar)

- **Serviço do inbox:** [inbox.service.ts](../../src/server/services/inbox.service.ts) — estados/filtros
  (~6-11, 76-145), `assignConversation` (~151-173), `resolveConversation` (~192-210).
- **UI lista:** [InboxView.tsx](../../src/components/inbox/InboxView.tsx) — SSE + polling 30s (~64-99),
  "Assumir" (~270-278).
- **UI conversa:** [ConversationView.tsx](../../src/components/ConversationView.tsx) — caixa de resposta
  (~344-392: texto + anexo + citar + "Sugerir resposta" ~198-217). É onde entram o `/` de snippet e o
  render das notas.
- **Atendimento humano:** [conversation.service.ts:~1016-1022](../../src/server/services/conversation.service.ts#L1016-L1022)
  — `applyManualResponseAttendance` grava `firstResponseAt` (~1020). Base do SLA.
- **Model Lead (campos de SLA já existem):** [schema.prisma:506-512](../../prisma/schema.prisma#L506-L512)
  — `attendanceStatus`, `assignedToId`, `queuedAt`, `firstResponseAt`, `lastReadAt`;
  [452-459](../../prisma/schema.prisma#L452-L459) — `AttendanceStatus`.
- **Barramento de eventos / SSE:** [src/server/events/bus.ts](../../src/server/events/bus.ts),
  `subscriber.ts`, e `src/app/api/stream/route.ts` (`useTenantStream`). Base da anti-colisão.
- **Redis:** já usado no projeto (`src/server/cache/redis.ts`) — TTL curto p/ presença.
- **PROD drift** ([[prod-schema-drift-destravar]]): models/colunas novas → SQL idempotente Onda D.

---

## Visão geral das fases

- **Fase 1** — Respostas rápidas (`QuickReply`: model + serviço + API + UI de gestão + inserção por `/`).
- **Fase 2** — SLA (meta no dono + cálculo puro de estouro + destaque na fila + coluna de tempo).
- **Fase 3** — Notas internas (`InternalNote`: model + serviço + API + render na conversa).
- **Fase 4** — Anti-colisão (presença via SSE/Redis + indicador na lista/cabeçalho).

Fase 1 tem o **maior ROI e menor custo** — comece por ela.

---

# FASE 1 — Respostas rápidas

## Task 1.1: Model `QuickReply` (Onda D)
**Files:** Modify `schema.prisma`; Create `prisma/manual/2026-07-07-onda-d.sql`.
```prisma
model QuickReply {
  id        String   @id @default(cuid())
  userId    String   // dono (tenant)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String   // rótulo curto ("saudação")
  body      String   // texto, aceita {{nome}}
  shortcut  String?  // atalho digitável após "/" (ex.: "oi")
  order     Int      @default(0)
  createdAt DateTime @default(now())
  @@unique([userId, shortcut])
  @@index([userId])
}
```
- push dev (pare o `next dev`). `onda-d.sql` idempotente (`CREATE TABLE IF NOT EXISTS` + índices). Commit.

## Task 1.2: `quick-reply.service` (CRUD, TDD)
**Files:** Create `src/server/services/quick-reply.service.ts`; Test.
- `listQuickReplies(userId)`, `createQuickReply`, `updateQuickReply`, `deleteQuickReply`. Escopo por
  conta; `shortcut` único por conta. Teste de escopo + unicidade. Commit.

## Task 1.3: Resolver variáveis (PURO, TDD)
**Files:** Create `src/lib/inbox/render-snippet.ts`; Test.
- `renderSnippet(body, { nome })` — troca `{{nome}}` (e futuros placeholders) com fallback vazio/limpo.
  Testes de substituição e de placeholder desconhecido. Commit.

## Task 1.4: API + UI de gestão (Configurações)
**Files:** Create `src/app/api/quick-replies/route.ts` + `[id]/route.ts`; Create
`src/components/inbox/QuickRepliesSettings.tsx`; Modify `configuracoes/page.tsx`.
- CRUD (espelha `catalog/[id]`). UI lista + adicionar/editar (título, corpo, atalho). Commit.

## Task 1.5: Inserção por `/` na caixa de resposta
**Files:** Modify `src/components/ConversationView.tsx`.
- Digitar `/` no início abre um seletor (lista + busca por título/atalho); escolher insere
  `renderSnippet(body, { nome: lead.name })` no textarea. Não envia sozinho (operador revisa).
  Verificação E2E + commit.

---

# FASE 2 — SLA real

## Task 2.1: Meta de SLA no dono (Onda D)
**Files:** Modify `schema.prisma` (`User.inboxSlaMinutes Int?`); append `onda-d.sql`; Modify a UI de
Configurações da conta p/ definir a meta (ex.: 5 min).
- push + SQL idempotente (`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inboxSlaMinutes" INTEGER`). Commit.

## Task 2.2: Cálculo de SLA (PURO, TDD)
**Files:** Create `src/lib/inbox/sla.ts`; Test.
- `slaState({ queuedAt, firstResponseAt, targetMinutes, now })` → `{ status: "ok"|"warning"|"breached",
  waitingMs }`. Regra: na fila sem 1ª resposta e `waiting > target` = breached; `> 0.7×target` = warning;
  respondida = ok (mede `firstResponseAt - queuedAt`). Testes das faixas + sem meta (null → sempre ok).
  Commit.

## Task 2.3: Expor SLA na lista + destaque
**Files:** Modify `inbox.service.ts` (incluir `queuedAt`/`firstResponseAt` + meta no payload da fila);
Modify `InboxView.tsx` / `ConversationListItem.tsx`.
- Coluna/selo de tempo de espera; linha destacada (token de cor) quando breached; ordena fila por mais
  antigo primeiro. Verificação visual + commit.

---

# FASE 3 — Notas internas

## Task 3.1: Model `InternalNote` (Onda D)
**Files:** Modify `schema.prisma`; append `onda-d.sql`.
```prisma
model InternalNote {
  id        String   @id @default(cuid())
  leadId    String
  lead      Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  authorId  String
  author    User     @relation("InternalNoteAuthor", fields: [authorId], references: [id])
  body      String
  createdAt DateTime @default(now())
  @@index([leadId, createdAt])
}
```
- Relações inversas em `Lead` e `User`. push + SQL idempotente. Commit.

## Task 3.2: `internal-note.service` + API (TDD)
**Files:** Create `src/server/services/internal-note.service.ts` + `src/app/api/inbox/[id]/notes/route.ts`.
- `listNotes(accountId, leadId)`, `addNote(accountId, leadId, authorId, body)` — escopo por conta.
  Teste de escopo + commit.

## Task 3.3: Render das notas na conversa
**Files:** Modify `ConversationView.tsx`.
- Aba/seção "Notas" (ou intercaladas com estilo distinto — fundo âmbar, "só a equipe vê"), com autor +
  horário. Campo pra adicionar nota. **Nunca** entra no fluxo de envio ao cliente. Verificação E2E + commit.

---

# FASE 4 — Anti-colisão (presença)

## Task 4.1: Presença efêmera via Redis + evento
**Files:** Create `src/server/services/presence.service.ts`; Modify `src/server/events/bus.ts` /
`subscriber.ts`.
- Ao abrir uma conversa, o cliente faz `heartbeat` (a cada ~15s) → `presence.service` grava chave
  `presence:{leadId}:{userId}` no Redis com TTL ~30s e publica no barramento. `whoIsViewing(leadId)`
  lê as chaves ativas. Teste do TTL/leitura (mock Redis). Commit.

## Task 4.2: Endpoint de heartbeat + consumo no SSE
**Files:** Create `src/app/api/inbox/[id]/presence/route.ts`; Modify `src/app/api/stream/route.ts` p/
emitir presença.
- POST heartbeat; o stream inclui "quem está vendo" por conversa. Commit.

## Task 4.3: Indicador na UI
**Files:** Modify `ConversationView.tsx` (cabeçalho: "Ana está atendendo") e `ConversationListItem.tsx`
(pontinho/avatar na lista).
- Informativo, não bloqueia. Se outro operador já está na conversa, mostra aviso antes de responder.
  Verificação E2E (dois navegadores) + commit.

---

## Verificação de ponta a ponta

1. Criar 2 respostas rápidas (uma com `{{nome}}`); na conversa, `/` insere o texto com o nome resolvido.
2. Definir meta de SLA 5min; deixar um lead na fila 6min → linha fica vermelha (breached); ao responder,
   registra o tempo de 1ª resposta.
3. Adicionar nota interna → aparece só na conversa, nunca é enviada ao cliente.
4. Abrir a mesma conversa em dois navegadores → cada um vê "o outro está atendendo".
5. `npx vitest run src/lib/inbox src/server/services/quick-reply.service.test.ts
   src/server/services/internal-note.service.test.ts src/server/services/presence.service.test.ts` verde +
   `npx tsc --noEmit`.
6. PROD: aplicar `2026-07-07-onda-d.sql`; abrir `/inbox` e `/configuracoes` sem 500.

---

## Riscos e notas

- **Respostas rápidas (Fase 1)** é o maior ganho pelo menor custo — não bloquear as outras fases se o
  tempo apertar; entregar a Fase 1 sozinha já vale.
- **SLA sem coluna nova** (reusa `queuedAt`/`firstResponseAt`) — só a meta é campo novo; barato.
- **Notas internas nunca vazam pro cliente** — cuidar do render e de jamais entrarem em
  `sendWhatsAppMessage`. Testar esse isolamento.
- **Presença (Fase 4)** é a parte mais incerta (efêmera, real-time) — depende de `REDIS_URL`
  provisionado ([[crm-inbox-db-push-pending]]); sem Redis, degrade para "última leitura" (`lastReadAt`)
  em vez de presença ao vivo, ou adie a fase.
- **PROD:** models/colunas na Onda D idempotente; não duplicar com migration versionada
  ([[prod-schema-drift-destravar]]).
