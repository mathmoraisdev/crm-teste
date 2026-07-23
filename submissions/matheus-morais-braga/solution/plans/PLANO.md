# Mini CRM de Prospecção com IA — Plano de Implementação

## Context

Teste técnico para vaga de **Head de IA**: construir um MVP funcional de uma plataforma onde o cliente sobe uma lista de leads (nome + telefone), dispara mensagens ativas no WhatsApp, conversa com cada lead, qualifica automaticamente com IA, move o lead num pipeline comercial e agenda reunião quando qualificado.

O objetivo não é só "funcionar", é **ser apresentável**: arquitetura em camadas bem desacoplada, UI limpa, modo mock de WhatsApp e Calendar para rodar localmente sem essas credenciais externas, e um README que demonstre visão de produção (filas, rate limit, observabilidade, LGPD, custo por lead qualificado, tiering de modelos).

> **Única credencial obrigatória:** `ANTHROPIC_API_KEY`. A IA (qualificação/conversa) é sempre real — não há mock de IA, pois é o núcleo do teste. O modo mock cobre **apenas** WhatsApp e Calendar; com a chave da Anthropic configurada, o avaliador roda o fluxo de ponta a ponta localmente, sem precisar de conta Meta nem Google.

**Decisões já fechadas com o usuário:**
- **IA:** Anthropic. Dois tiers — `claude-haiku-4-5` (classificação/próxima pergunta, barato) e `claude-sonnet-4-6` (qualificação estruturada / decisões). Atende diretamente o requisito 11.
- **Postgres:** via Docker Compose (reprodutível, zero conta externa).
- **Agendamento:** conversacional — a IA sugere 2-3 horários no WhatsApp e o lead aceita por texto; a IA interpreta a escolha e cria o evento.
- **Modo padrão:** `mock` para WhatsApp e Calendar, para o avaliador rodar tudo localmente sem conta Meta/Google (a chave da Anthropic continua necessária). Implementações `cloud-api` / `google-calendar` ficam prontas e selecionáveis por env.

---

## 1. Arquitetura geral

Next.js 15 (App Router) como full-stack: páginas React (Server + Client Components) + Route Handlers servindo a API. Toda regra de negócio vive em `server/`, nunca nos componentes ou nas rotas (as rotas só validam input e delegam aos services).

```
┌─────────────────────────────────────────────────────────────┐
│  UI (app/ + components/)  — Dashboard, conversa, campanhas    │
└───────────────┬───────────────────────────────────────────────┘
                │ fetch
┌───────────────▼───────────────────────────────────────────────┐
│  API Route Handlers (app/api/*) — validação (zod) + delegação  │
└───────────────┬───────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────┐
│  server/services — orquestração de domínio                     │
│   lead · campaign · conversation · qualification · scheduling  │
│   + pipeline.ts (state machine de status)                      │
└───┬───────────────┬──────────────┬───────────────┬────────────┘
    │               │              │               │
┌───▼────┐   ┌──────▼─────┐  ┌─────▼──────┐  ┌──────▼──────┐
│server/ │   │ server/ai  │  │server/     │  │server/      │
│  db    │   │ (Anthropic │  │ whatsapp   │  │ calendar    │
│(Prisma)│   │  2 tiers)  │  │mock│cloud  │  │mock│google  │
└────────┘   └────────────┘  └────────────┘  └─────────────┘
```

**Princípio central:** WhatsApp e Calendar são interfaces (`WhatsAppService`, `CalendarService`) resolvidas por uma factory que lê `WHATSAPP_MODE` / `CALENDAR_MODE` do env. Os services de domínio dependem da **interface**, nunca da implementação concreta. Trocar mock → API real = trocar uma env var, zero mudança de código de negócio.

**Loop do agente de IA (orquestrado em `conversation.service`):**
1. Inbound chega no webhook → dedupe por `providerMessageId` → salva `Message(INBOUND)`.
2. Lead em `NOVO`/`CONTATADO` → passa para `EM_CONVERSA`.
3. **Agente de qualificação** (Sonnet, JSON estruturado via tool-use forçado) analisa a conversa inteira → produz o JSON de qualificação (inclui `score` 0–100 e `nextAction ∈ { ask_question | schedule_meeting | discard }`) → upsert em `Qualification`.
4. **Regras de pipeline** (state machine pura em `pipeline.ts`, função de `(statusAtual, score, nextAction)`):
   - `score >= 70` **ou** `nextAction = schedule_meeting` → `QUALIFICADO`.
   - `score < 40` **e** `nextAction = discard` → `DESCARTADO` (encerra; sem resposta).
   - caso contrário → permanece `EM_CONVERSA` (faixa 40–69, ou ainda sem sinal forte).
5. Decisão de próxima ação:
   - status virou `QUALIFICADO` → entra no subfluxo de agendamento (a IA passa a propor horários).
   - status `DESCARTADO` → não responde.
   - senão → **agente de conversa** (Haiku) gera a próxima pergunta e responde via WhatsApp.

   > O limiar de descarte exige **score baixo *e* sinal explícito de desinteresse da IA** (`discard`), evitando descartar um lead que ainda está só no começo da conversa com score naturalmente baixo.
6. Subfluxo de agendamento: busca disponibilidade no Calendar → propõe slots → no próximo inbound a IA interpreta a escolha → cria evento → `REUNIAO_AGENDADA` → envia confirmação.

---

## 2. Estrutura de pastas

```
teste-crm/
├── docker-compose.yml            # Postgres 16
├── .env.example
├── README.md
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                   # campanha + leads de exemplo
├── public/
│   └── sample-leads.csv
└── src/
    ├── app/
    │   ├── layout.tsx · globals.css
    │   ├── page.tsx              # → redirect /leads
    │   ├── leads/page.tsx        # Dashboard (tabela + kanban)
    │   ├── leads/[id]/page.tsx   # Detalhe + conversa
    │   ├── campaigns/page.tsx    # Criar / iniciar campanha
    │   └── api/
    │       ├── leads/route.ts             # GET lista · POST cria
    │       ├── leads/import/route.ts      # POST CSV
    │       ├── leads/[id]/route.ts        # GET lead+mensagens
    │       ├── campaigns/route.ts         # GET/POST
    │       ├── campaigns/[id]/start/route.ts   # POST dispara
    │       ├── webhooks/whatsapp/route.ts # GET verify · POST inbound
    │       └── dev/simulate-reply/route.ts # mock: lead responde (demo local)
    ├── components/
    │   ├── ui/                   # Button, Badge, Card, Table, Modal, Spinner
    │   ├── LeadsTable.tsx · PipelineBoard.tsx
    │   ├── LeadStatusBadge.tsx · ScoreBadge.tsx
    │   ├── ConversationView.tsx · CsvUpload.tsx · CampaignForm.tsx
    │   └── QualificationPanel.tsx
    ├── server/
    │   ├── db/client.ts          # PrismaClient singleton
    │   ├── ai/
    │   │   ├── provider.ts       # client Anthropic + MODELS.cheap/strong
    │   │   ├── qualification.agent.ts   # Sonnet, structured output
    │   │   ├── conversation.agent.ts    # Haiku, próxima pergunta / parse escolha
    │   │   └── prompts.ts · schemas.ts  # zod + JSON schema (tool-use)
    │   ├── whatsapp/  types.ts · mock.ts · cloud-api.ts · index.ts (factory)
    │   ├── calendar/  types.ts · mock.ts · google-calendar.ts · index.ts (factory)
    │   └── services/
    │       ├── lead.service.ts · campaign.service.ts
    │       ├── conversation.service.ts  # orquestra o loop inbound
    │       ├── qualification.service.ts · scheduling.service.ts
    │       └── pipeline.ts        # transições de status (pura, testável)
    └── lib/
        ├── csv.ts · phone.ts · env.ts (validação zod) · utils.ts (cn, datas)
```

---

## 3. Modelagem do banco (Prisma)

```prisma
enum LeadStatus { NOVO CONTATADO EM_CONVERSA QUALIFICADO REUNIAO_AGENDADA DESCARTADO }
enum MessageDirection { INBOUND OUTBOUND }
enum MessageStatus { SENT DELIVERED READ FAILED }
enum CampaignStatus { DRAFT RUNNING COMPLETED }
enum MeetingStatus { PROPOSED CONFIRMED CANCELLED }

model Lead {
  id         String     @id @default(cuid())
  name       String
  phone      String     @unique          // E.164 normalizado
  status     LeadStatus @default(NOVO)
  score      Int        @default(0)
  campaign   Campaign?  @relation(fields: [campaignId], references: [id])
  campaignId String?
  messages   Message[]
  qualification Qualification?
  meeting    Meeting?
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
}

model Message {
  id                String   @id @default(cuid())
  lead              Lead     @relation(fields: [leadId], references: [id])
  leadId            String
  direction         MessageDirection
  content           String
  providerMessageId String?  @unique      // dedupe de webhook
  status            MessageStatus?
  createdAt         DateTime @default(now())
  @@index([leadId, createdAt])
}

model Campaign {
  id              String         @id @default(cuid())
  name            String
  messageTemplate String                       // contém {{nome}}
  status          CampaignStatus @default(DRAFT)
  leads           Lead[]
  createdAt       DateTime       @default(now())
}

model Qualification {           // 1:1 com Lead
  id                  String  @id @default(cuid())
  lead                Lead    @relation(fields: [leadId], references: [id])
  leadId              String  @unique
  interestLevel       String?
  painPoint           String?
  segment             String?
  isDecisionMaker     Boolean?
  urgency             String?
  budget              String?
  preferredMeetingTime String?
  score               Int     @default(0)   // espelhado em Lead.score (cópia desnormalizada p/ listagem)
  summary             String?
  nextAction          String?                // "ask_question" | "schedule_meeting" | "discard"
  raw                 Json                     // JSON bruto da IA (auditoria)
  updatedAt           DateTime @updatedAt
}

model Meeting {                 // 1:1 com Lead
  id              String        @id @default(cuid())
  lead            Lead          @relation(fields: [leadId], references: [id])
  leadId          String        @unique
  status          MeetingStatus @default(PROPOSED)
  proposedSlots   Json                          // ISO datetimes propostos
  scheduledAt     DateTime?
  calendarEventId String?
  meetingLink     String?
  createdAt       DateTime      @default(now())
}
```

Relacionamentos: Lead 1‑N Message; Lead 1‑1 Qualification; Lead 1‑1 Meeting; Campaign 1‑N Lead. (Para o MVP usa `prisma db push`; migrations versionadas ficam como nota de produção no README.)

---

## 4. Fluxo completo do usuário

1. **Importar leads** — Dashboard → "Importar CSV" → sobe `nome,telefone` → `lib/csv` parseia, `lib/phone` normaliza para E.164 → leads salvos como `NOVO` (dedupe por telefone).
2. **Criar campanha** — define nome + template (`Olá {{nome}}...`) e associa os leads `NOVO`.
3. **Iniciar disparo** — botão "Iniciar campanha" → para cada lead: renderiza template, `whatsApp.sendMessage()`, salva `Message(OUTBOUND)`, move para `CONTATADO`. No modo mock, a mensagem é logada e aparece na conversa.
4. **Lead responde** — no real, via webhook; no mock, o avaliador usa o input "responder como lead" na tela de conversa (chama `/api/dev/simulate-reply`, que gera um `providerMessageId` sintético e injeta no mesmo pipeline do webhook — espelhando produção, inclusive o dedupe).
5. **IA qualifica** — `conversation.service` roda o agente, atualiza `Qualification` + score, aplica regras de pipeline e responde (próxima pergunta) automaticamente. Lead vai para `EM_CONVERSA`.
6. **Qualificação** — score ≥ 70 → `QUALIFICADO`; a IA passa a propor horários.
7. **Agendamento** — IA sugere slots (Calendar service) → lead aceita por texto → evento criado → `REUNIAO_AGENDADA` → confirmação enviada no WhatsApp.
8. **Descarte** — quando a IA sinaliza desinteresse (`nextAction = discard`) com score < 40 → `DESCARTADO`.
9. Tudo visível em tempo near-real no Dashboard (tabela + kanban, com polling leve).

---

## 5. Endpoints necessários

| Método | Rota | Função |
|---|---|---|
| GET | `/api/leads` | Lista leads (status, score, última msg, data) |
| POST | `/api/leads/import` | Upload CSV → cria leads `NOVO` |
| GET | `/api/leads/:id` | Lead + mensagens + qualificação + reunião |
| GET/POST | `/api/campaigns` | Lista / cria campanha |
| POST | `/api/campaigns/:id/start` | Dispara mensagens iniciais |
| GET | `/api/webhooks/whatsapp` | Verificação (`hub.challenge`) |
| POST | `/api/webhooks/whatsapp` | Recebe inbound → orquestra o loop de IA |
| POST | `/api/dev/simulate-reply` | (mock) simula resposta do lead p/ demo local |

---

## 6. Plano de implementação por etapas

1. **Scaffold + infra** — Next 15 + TS + Tailwind; `docker-compose.yml` (Postgres 16); Prisma init; `server/db/client.ts` (singleton); `lib/env.ts` (validação zod); primitivos de UI + layout/tema.
2. **Schema + seed** — `schema.prisma` completo, `db push`, `seed.ts` com campanha + leads de exemplo; `public/sample-leads.csv`.
3. **Leads & Dashboard** — `lib/csv` + `lib/phone`; `lead.service`; `/api/leads`, `/api/leads/import`, `/api/leads/:id`; página de lista (`LeadsTable` + `PipelineBoard`) e detalhe (`ConversationView`, `QualificationPanel`); `CsvUpload`.
4. **Camada WhatsApp** — `types.ts` (interface), `mock.ts` (loga + persiste), `cloud-api.ts` (Graph API, pronta), `index.ts` (factory por env).
5. **Campanhas** — `campaign.service` (template `{{nome}}`, disparo, `CONTATADO`, log); `/api/campaigns` + `/start`; `CampaignForm`.
6. **Camada de IA** — `provider.ts` (Anthropic, MODELS.cheap/strong); `schemas.ts` (zod + JSON schema p/ tool-use forçado, incluindo o enum `nextAction`); `qualification.agent` (Sonnet) e `conversation.agent` (Haiku); `prompts.ts`.
7. **Webhook + orquestração** — `conversation.service` (dedupe, salva, `EM_CONVERSA`, roda qualificação, aplica `pipeline.ts`, responde); `/api/webhooks/whatsapp` (GET+POST) e `/api/dev/simulate-reply`.
8. **Camada Calendar + agendamento** — `types/mock/google-calendar/index`; `scheduling.service` (disponibilidade → propõe → interpreta aceite → cria evento → `REUNIAO_AGENDADA` → confirma).
9. **Polish de UI/pipeline** — kanban de leitura, badges de status/score, coluna última mensagem, polling, estados de loading/erro, responsividade.
10. **README + produção** — README forte (objetivo, fluxo, arquitetura, como rodar, env, mock↔real, próximos passos) + seção **"Decisões de arquitetura para produção"** cobrindo filas, rate limit do WhatsApp, retry, observabilidade, human handoff, opt-in/LGPD, métricas de conversão, custo por lead qualificado e separação IA barata×forte.

---

## Verificação (end-to-end local; WhatsApp/Calendar em mock, IA real)

1. `cp .env.example .env` e preencher `ANTHROPIC_API_KEY` (WhatsApp/Calendar ficam em `mock` por padrão) → `docker compose up -d` → `npm install` → `npx prisma db push` → `npm run seed` → `npm run dev`.
2. Abrir Dashboard, importar `public/sample-leads.csv` → leads aparecem como `NOVO`.
3. Criar campanha, clicar "Iniciar" → leads viram `CONTATADO`, mensagem inicial visível na conversa.
4. Abrir um lead, usar "responder como lead" algumas vezes → observar IA qualificando, score subindo, status `EM_CONVERSA` → `QUALIFICADO`.
5. Continuar → IA propõe horários, aceitar um → evento criado (mock), status `REUNIAO_AGENDADA`, confirmação na conversa.
6. Testar caminho de descarte (respostas desinteressadas) → `DESCARTADO`.
7. (Opcional) teste unitário de `pipeline.ts` — função pura de transição por score.
8. Conferir que setar `WHATSAPP_MODE=cloud-api` / `CALENDAR_MODE=google-calendar` carrega as implementações reais sem tocar no código de domínio.

## Dependências principais
`next@15`, `react`, `typescript`, `tailwindcss`, `prisma` + `@prisma/client`, `@anthropic-ai/sdk`, `zod`, `papaparse` (CSV), `googleapis` (Calendar real), `lucide-react` (ícones). WhatsApp Cloud API via `fetch` (Graph API), sem SDK extra.
