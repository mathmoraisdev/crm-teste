# Paridade de CRM + Inbox de Atendimento (Onda 1 + Multiatendimento) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use `executing-plans` para implementar task-a-task, com checkpoint de revisão entre fases.

> **Status: PRONTO p/ implementação (2026-06-27).** Plano único: a **Parte A (CRM)** entrega tags, campos customizados, kanban interativo e painel; a **Parte B (Inbox)** entrega o multiatendimento humano. São ordenadas porque **B depende de A**: o `dashboard.service` (A4) é estendido pelo SLA do inbox (B5); a coluna direita do inbox (B4) reusa tags/campos (A1/A2). Verificado contra o código — ver suposições por fase.

**Goal:** Fechar de uma vez os gaps que nos separam de um CRM de WhatsApp "completo" (estilo DataCrazy), sem diluir o diferencial (IA que qualifica/agenda sozinha). Duas frentes num só fluxo:
- **Parte A — Paridade de CRM:** tags coloridas, campos customizados, kanban arrastável e painel de métricas real.
- **Parte B — Inbox + handoff IA↔humano:** caixa de atendimento com fila, atribuição, estados, não-lidas e SLA de 1ª resposta.

**Decisões estruturais travadas (não relitigar):**
- **Etapas do funil continuam FIXAS (enum `LeadStatus`).** O motor de IA (`decidePipeline`, `respondToLead`) depende da semântica do enum — criar/remover etapas livremente quebraria a IA. Permitido apenas **renomear rótulos por conta** (A3). "Adicionar/reordenar etapas" e "múltiplos funis" = fora de escopo. Esta é a resposta deliberada ao "construtor de pipeline".
- **Conversa = Lead.** A identidade `(whatsAppNumberId, phone)` já é a conversa; campos de atendimento entram no `Lead`, sem modelo `Conversation` novo.
- **`aiPaused` segue sendo o flag de motor** (IA responde ou não); `attendanceStatus` é a camada de workflow humano, derivada.
- **Tempo real via polling** (3–4s, padrão do projeto), sem WebSocket.
- **Sem tocar worker de disparo nem billing.** Inbound já persiste mensagens mesmo com IA pausada/conta suspensa; o inbox só lê e responde. Opt-out/billing mantêm precedência (já garantido em `ingestInbound`).
- **Drag-and-drop com HTML5 nativo** (zero dependência nova). MVP usa `prisma db push` (sem migration versionada).

**Contexto compartilhado (o que já existe):**
- Lead/serviço: [src/server/services/lead.service.ts](../../src/server/services/lead.service.ts) (`listLeads`, `getLeadDetail`, `updateLead` já aceita `status`).
- Listagem + kanban: [src/components/LeadsDashboard.tsx](../../src/components/LeadsDashboard.tsx), [src/components/PipelineBoard.tsx](../../src/components/PipelineBoard.tsx) (**hoje só leitura**), [src/components/LeadsTable.tsx](../../src/components/LeadsTable.tsx).
- Status: [src/lib/leadStatus.ts](../../src/lib/leadStatus.ts) (`LEAD_STATUS_META`, `PIPELINE_ORDER`).
- Detalhe/conversa: [src/components/LeadDetailView.tsx](../../src/components/LeadDetailView.tsx), [src/components/ConversationView.tsx](../../src/components/ConversationView.tsx), [src/components/QualificationPanel.tsx](../../src/components/QualificationPanel.tsx), [src/components/LeadForm.tsx](../../src/components/LeadForm.tsx).
- Handoff (fundação já pronta): [src/server/services/conversation.service.ts](../../src/server/services/conversation.service.ts) — `setHandoff`, `sendManualReply`, `handleOperatorMessage`, `respondToLead` (respeita `aiPaused`/resume por inatividade). APIs: `POST /api/leads/[id]/reply`, `POST /api/leads/[id]/handoff`. Lead já tem `aiPaused`/`aiPausedAt`.
- Tenancy/papéis: [src/lib/tenant.ts](../../src/lib/tenant.ts) (`getTenantContext` → `sessionUserId`+`tenantUserId`+`role`; `getTenantUserId`), [src/server/services/team.service.ts](../../src/server/services/team.service.ts) (`listMembers`).
- Update do lead: **`PATCH /api/leads/[id]`** ([route.ts](<../../src/app/api/leads/[id]/route.ts>)), já valida `status` por Zod.
- UI kit: `Button`, `Card`/`CardHeader`, `Modal`, `Badge`(`Tone`), `StatCard`, `ScoreBadge`, `LoadingBlock`. Sidebar: [src/components/app/Sidebar.tsx](../../src/components/app/Sidebar.tsx).

**Tech Stack:** Next.js 15 (App Router), Prisma + PostgreSQL, Tailwind, TypeScript estrito.

---

# PARTE A — Paridade de CRM

## Fase A1 — Tags coloridas

### Task A1.1: Schema `Tag` + N:N
**Files:** Modify [prisma/schema.prisma](../../prisma/schema.prisma)
```prisma
model Tag {
  id        String   @id @default(cuid())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  name      String
  color     String   @default("slate") // chave de Tone (Badge)
  leads     Lead[]   @relation("LeadTags")
  createdAt DateTime @default(now())
  @@unique([userId, name])
  @@index([userId])
}
```
`Lead`: `tags Tag[] @relation("LeadTags")`. `User`: `tags Tag[]`.
**Step:** `npx prisma db push && npx prisma generate`.

### Task A1.2: Service
**Files:** Create `src/server/services/tag.service.ts` — `listTags` (com `_count.leads`), `createTag` (cor ∈ `Tone`, nome único→P2002 amigável), `updateTag`, `deleteTag`, `setLeadTags(userId, leadId, tagIds[])` (valida posse de lead e tags; `tags:{ set }`). Estender `LeadListItem` + `listLeads`/`getLeadDetail` com `tags:{id,name,color}[]`.

### Task A1.3: API
**Files:** Create `src/app/api/tags/route.ts` (GET/POST), `src/app/api/tags/[id]/route.ts` (PATCH/DELETE), `src/app/api/leads/[id]/tags/route.ts` (PUT `{tagIds}`). Padrão: `getTenantUserId()`→401, Zod, try/catch→400, `dynamic="force-dynamic"`.

### Task A1.4: UI
**Files:** Create `src/components/TagChip.tsx` (Badge colorida), `TagPicker.tsx` (multi-select + criar inline), `TagManagerModal.tsx` (CRUD). Modify [LeadsTable.tsx](../../src/components/LeadsTable.tsx)/[PipelineBoard.tsx](../../src/components/PipelineBoard.tsx) (chips no card), [LeadDetailView.tsx](../../src/components/LeadDetailView.tsx) (TagPicker), [LeadsDashboard.tsx](../../src/components/LeadsDashboard.tsx) (filtro Tag + botão "Gerenciar tags").
**Run:** `npx tsc --noEmit` limpo.

## Fase A2 — Campos customizados

### Task A2.1: Schema
**Files:** Modify [prisma/schema.prisma](../../prisma/schema.prisma)
```prisma
enum CustomFieldType { TEXT NUMBER DATE SELECT BOOLEAN }
model CustomFieldDef {
  id String @id @default(cuid())
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId String
  key String      // slug estável (chave no Json)
  label String
  type CustomFieldType @default(TEXT)
  options Json?    // SELECT: ["A","B"]
  order Int @default(0)
  createdAt DateTime @default(now())
  @@unique([userId, key])
  @@index([userId])
}
```
`Lead`: `customFields Json?`. `User`: `customFieldDefs CustomFieldDef[]`. **Step:** `db push && generate`.

### Task A2.2: Service + API
**Files:** Create `src/server/services/custom-field.service.ts` (`listDefs`, `createDef` com slug de `key`, `updateDef`, `deleteDef`), `src/app/api/custom-fields/route.ts` + `[id]/route.ts`. Estender `updateSchema`/`updateLead` (PATCH lead) para aceitar `customFields` (merge raso; valida cada `key` ∈ defs do dono e valor casa `type`).

### Task A2.3: UI
**Files:** Modify [LeadForm.tsx](../../src/components/LeadForm.tsx) (render dinâmico por tipo), [QualificationPanel.tsx](../../src/components/QualificationPanel.tsx) (exibir valores). Create `CustomFieldsManager.tsx` (CRUD dos defs em /configuracoes). **Run:** `npx tsc --noEmit` limpo.

## Fase A3 — Kanban interativo + rótulos por conta

### Task A3.1: Arrastar p/ mudar etapa
**Files:** Modify [PipelineBoard.tsx](../../src/components/PipelineBoard.tsx), [LeadsDashboard.tsx](../../src/components/LeadsDashboard.tsx)
- Card `draggable` (`onDragStart`→`setData(leadId)`); coluna `onDragOver`/`onDrop`→`onMove(leadId,status)`.
- `onMove`: update otimista local → `PATCH /api/leads/${id}{status}` → erro reverte + toast. Polling 4s reconcilia.
- Card vira `<div role="button">`+`router.push` no clique (conviver com drag; só navega se não houve arrasto).
> Mover manual p/ `REUNIAO_AGENDADA`/`DESCARTADO` **não** cria reunião nem dispara IA — só rótulo. Tooltip avisa.

### Task A3.2: Rótulos renomeáveis (sem tocar o enum)
**Files:** Modify [prisma/schema.prisma](../../prisma/schema.prisma) (`User.pipelineLabels Json?`), [leadStatus.ts](../../src/lib/leadStatus.ts), consumidores de label.
- `resolveStatusMeta(labels)` mescla `pipelineLabels` sobre `LEAD_STATUS_META` (só `label`). Passar labels do server via prop. UI de edição em /configuracoes (`PUT /api/account/pipeline-labels`).
> **Escopo:** se espalhar demais nos componentes, entregar A3 só com A3.1 (arrastar = 80% do valor) e adiar A3.2.
**Run:** `npx tsc --noEmit` limpo; arrastar persiste após reload.

## Fase A4 — Painel `/painel`

### Task A4.1: `dashboard.service.ts`
**Files:** Create `src/server/services/dashboard.service.ts` — `getDashboard(userId,{days=30})`: funil por `LeadStatus`; taxas (qualificados/total, reuniões/qualificados — **nunca dividir por 0**); volume INBOUND/OUTBOUND e novos leads/dia; por empresa (`whatsAppNumberId`); por campanha (de `OutboundJob`: SENT/FAILED); reuniões confirmadas no período. Usar `groupBy`/`count` (sem N+1).

### Task A4.2: UI
**Files:** Create `src/app/(app)/painel/page.tsx` + `src/components/DashboardView.tsx`. Modify [Sidebar.tsx](../../src/components/app/Sidebar.tsx) (item "Painel" no topo, ícone `LayoutDashboard`).
- Linha de `StatCard`; funil em barras (CSS, `LEAD_STATUS_META.tone`); tabelas por-empresa e por-campanha; seletor 7/30/90 dias (`?days=`). Sem lib de gráfico no MVP.
**Run:** `npx tsc --noEmit` limpo; `/painel` com dados reais.

---

# PARTE B — Inbox de Atendimento + Handoff

> **Conceito:** Inbox = lista de conversas (atividade recente, não-lidas) → conversa → painel do lead, com fila, atribuição, estado e SLA. Handoff = ponte IA↔humano (IA atende; humano assume com `aiPaused=true`; ao resolver, devolve à IA). Fundação já existe (`setHandoff`/`sendManualReply`/`handleOperatorMessage`); falta a tela + estado de fila/atribuição + SLA.

## Fase B1 — Schema de atendimento

### Task B1.1: Campos no `Lead`
**Files:** Modify [prisma/schema.prisma](../../prisma/schema.prisma)
```prisma
enum AttendanceStatus { IA FILA ATENDENDO AGUARDANDO RESOLVIDA }
```
`Lead`:
```prisma
  attendanceStatus AttendanceStatus @default(IA)
  assignedTo   User?    @relation("AssignedLeads", fields: [assignedToId], references: [id], onDelete: SetNull)
  assignedToId String?
  queuedAt        DateTime?  // entrou na FILA (base SLA)
  firstResponseAt DateTime?  // 1ª resposta humana após a fila (SLA)
  lastReadAt      DateTime?  // leitura (inbox compartilhado)
  @@index([userId, attendanceStatus])
  @@index([assignedToId])
```
`User`: `assignedLeads Lead[] @relation("AssignedLeads")`. **Step:** `db push && generate`.

## Fase B2 — Service do inbox + wiring do handoff

### Task B2.1: `inbox.service.ts`
**Files:** Create `src/server/services/inbox.service.ts`
- `listConversations(tenantUserId,{filter,sessionUserId})` → `attendanceStatus in [FILA,ATENDENDO,AGUARDANDO]`; filtros `fila|minhas|todas|resolvidas`. Retorna `{id,name,phone,attendanceStatus,assignedTo:{id,name}|null,lastMessage,lastMessageAt,unread,whatsAppNumber:{displayName|label},queuedAt}`. `unread = lastInbound.createdAt > (lastReadAt??0)`. Ordena por `lastMessageAt desc`, não-lidas primeiro.
- `assignConversation(tenantUserId,leadId,operatorId)` → valida lead do tenant + operador da conta (`listMembers ∪ dono`); `assignedToId`, `attendanceStatus=ATENDENDO`, `aiPaused=true`, `aiPausedAt=now`, `queuedAt` se vazio.
- `enqueueConversation` → `FILA`, `aiPaused=true`, `queuedAt` se vazio.
- `resolveConversation(...,{returnToAi=true})` → `RESOLVIDA`; se `returnToAi`, `aiPaused=false`/`aiPausedAt=null`.
- `markRead` → `lastReadAt=now`. `inboxCounts(tenantUserId,sessionUserId)` → `{fila,minhas,naoLidas}`.

### Task B2.2: Conectar handoffs existentes
**Files:** Modify [conversation.service.ts](../../src/server/services/conversation.service.ts)
- `setHandoff(paused=true)` → também `attendanceStatus=FILA`+`queuedAt`(se vazio); `paused=false` → `IA`+limpa `assignedToId`.
- `sendManualReply` → se `queuedAt` setado e `firstResponseAt` vazio, grava `firstResponseAt=now` (fecha SLA); ATENDENDO→AGUARDANDO.
- `handleOperatorMessage` (resposta pelo zap) → mesmo tratamento de SLA.
- `respondToLead` (resume por inatividade) → volta `attendanceStatus=IA`. **Não** mexer na precedência opt-out/billing; reusar o recheck `aiStillActive`.

## Fase B3 — API do inbox
**Files:** Create `src/app/api/inbox/route.ts` (GET `?filter=`, usa `getTenantContext` p/ tenant+session), `src/app/api/inbox/[id]/assign/route.ts` (POST `{operatorId?}`, default self), `.../resolve/route.ts` (POST `{returnToAi?}`), `.../read/route.ts` (POST). Reply e enqueue reusam `/api/leads/[id]/reply` e `/handoff`. Padrão de handler já citado.

## Fase B4 — UI `/inbox` (3 colunas)
**Files:** Create `src/app/(app)/inbox/page.tsx` + `src/components/inbox/{InboxView,ConversationList,ConversationListItem}.tsx`. Reusar [ConversationView.tsx](../../src/components/ConversationView.tsx) no centro.
- **Esquerda:** abas `Fila(n)·Minhas(n)·Todas·Resolvidas`; item com nome, prévia, hora, bolinha não-lida, status, empresa. Polling 4s. Selecionar → `read` + abre.
- **Centro:** header (nome/telefone/empresa/status) + ações **Assumir**/**Resolver**/**Devolver à IA** + `ConversationView` (caixa via `/reply`).
- **Direita:** `QualificationPanel` + tags/campos (A1/A2) + link "abrir no CRM".
- Mostrar `assignedTo?.name` ("Você"/colega); "Assumir" some quando já é seu.
**Run:** `npx tsc --noEmit` limpo; assumir→responder→resolver; não-lida some ao abrir.

## Fase B5 — Sidebar + SLA no painel
**Files:** Modify [Sidebar.tsx](../../src/components/app/Sidebar.tsx) — item **"Atendimento"** após "Conversas" com badge (fila+não-lidas); renomear "Conversas"(/leads) → **"Leads"**. Modify `dashboard.service.ts` (de A4) — **tempo médio até 1ª resposta** (`avg(firstResponseAt−queuedAt)`) e resolvidas/dia por atendente; render no `/painel`. (É o "SLA de 5 min" do concorrente.)
**Run:** `npx tsc --noEmit` limpo; SLA calculado em lead de teste.

## Fase B6 — (Opcional) Auto-handoff pela IA & round-robin
> Pós-MVP. Mantém o diferencial: a IA decide quando passar p/ humano.
- `nextAction="handoff"` no [qualification.agent.ts](../../src/server/ai/qualification.agent.ts); em `respondToLead`, IA sem resposta / lead pede humano → `enqueueConversation` (cuidar p/ não criar loop com o resume por inatividade).
- Round-robin em `enqueueConversation`: operador com menos `ATENDENDO` ativos (`groupBy assignedToId`).

---

# Verificação & commits

### Testes (Vitest, `vi.mock("@/server/db/client")`, import dinâmico após o mock)
**Files:** Create `tag.service.test.ts`, `custom-field.service.test.ts`, `dashboard.service.test.ts`, `inbox.service.test.ts`. Cobrir: nome de tag duplicado; `setLeadTags`/`assignConversation` rejeitam recurso de outra conta; `customFields` rejeita key inexistente; taxas com divisor zero; `firstResponseAt` grava só na 1ª resposta após `queuedAt`; `resolveConversation` devolve à IA; `markRead` zera não-lida.

### Verificação manual
- [ ] **A:** criar/atribuir/filtrar tag; campo SELECT no lead; arrastar card persiste após reload (erro reverte); renomear etapa reflete (se A3.2); `/painel` com funil/conversão/por-empresa/por-campanha e troca de período.
- [ ] **B:** lead com IA ligada fica em `IA` (fora do inbox); "Assumir"→`ATENDENDO`, IA silencia, queuedAt/atribuição; responder→`firstResponseAt`(SLA)+`AGUARDANDO`; cliente responde→não-lida acende, abrir apaga; "Resolver+devolver à IA"→`RESOLVIDA`, nova msg volta a ser respondida pela IA; resposta pelo zap conta no inbox+SLA; operador A não vê "Assumir" em conversa do B.

### Commits (um por fase)
```
feat(crm): tags coloridas em leads (catálogo + atribuição + filtro)
feat(crm): campos customizados por conta
feat(crm): kanban interativo (arrastar p/ mudar etapa)
feat(crm): painel de métricas (/painel)
feat(inbox): estado de atendimento no lead (fila/atribuição/SLA)
feat(inbox): service + API de multiatendimento
feat(inbox): tela de atendimento /inbox (3 colunas)
feat(inbox): sidebar + métrica de tempo de 1ª resposta
```

---

## Ordem recomendada de execução
A1 → A2 → A3 → A4 → B1 → B2 → B3 → B4 → B5. **B5 estende o `dashboard.service` criado em A4**, e **B4 reusa tags/campos de A1/A2** — por isso A vem antes de B. Cada fase é entregável e commitável de forma independente; dá para pausar entre qualquer fase.

## Fora de escopo (decisões conscientes)
- **Adicionar/remover/reordenar etapas e múltiplos funis** (conflita com o enum que sustenta a IA).
- **Construtor visual de automação no-code** (Onda 3; e na nossa versão deve acionar a IA).
- **Gráficos de série temporal / BI avançado (LTV, CAC)** (faltam dados de receita por lead).
- **Webhooks outbound / API pública documentada** (onda futura).
- **Não-lidas por operador** (MVP usa `lastReadAt` compartilhado); **WebSocket** (polling basta); **outros canais** (Instagram/Facebook/SMS — próxima onda); **macros/notas internas/transferência entre operadores**; **auto-handoff IA + round-robin** (Fase B6 opcional).

## Checklist de aceite
- [ ] Schema: `Tag`, `CustomFieldDef`, `AttendanceStatus`+campos de atendimento, `pipelineLabels` — `db push` aplicado, client regenerado.
- [ ] Tags e campos customizados funcionando (catálogo + atribuição + filtro + form/detalhe).
- [ ] Kanban arrastável via `PATCH /api/leads/[id]`.
- [ ] `/painel` com funil/conversão/por-empresa/por-campanha + SLA de 1ª resposta.
- [ ] `/inbox` 3 colunas: fila, assumir, responder, resolver, devolver à IA, não-lidas.
- [ ] Sidebar com "Atendimento" (badge) e "Leads" separados.
- [ ] `npx tsc --noEmit` limpo; testes de service passando; cenários manuais A e B ok.
