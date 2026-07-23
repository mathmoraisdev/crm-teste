Você é um arquiteto de software sênior e especialista em IA aplicada a vendas.

Preciso criar um MVP funcional para um teste técnico de uma vaga de Head de IA.

Contexto do teste:
Construir uma plataforma de IA onde um cliente consiga subir uma lista de leads com nome e telefone. A plataforma deve disparar mensagens ativas no WhatsApp, iniciar conversa com cada lead, receber respostas, qualificar automaticamente com IA, mover o lead em um pipeline comercial e, quando o lead estiver qualificado, agendar uma reunião automaticamente.

Objetivo:
Criar um mini CRM de prospecção com IA, WhatsApp e agendamento.

Stack desejada:

* Next.js 15
* TypeScript
* Tailwind CSS
* PostgreSQL
* Prisma ORM
* OpenAI ou Anthropic para IA
* WhatsApp Cloud API, com opção de modo mock para teste local
* Google Calendar API, com opção de modo mock para teste local

Requisitos principais:

1. Dashboard
   Criar uma interface administrativa com:

* Lista de leads
* Nome
* Telefone
* Status no pipeline
* Score de qualificação
* Última mensagem
* Data de criação
* Botão para visualizar conversa
* Botão para iniciar campanha

2. Upload de leads
   Criar funcionalidade para importar CSV com:

* nome
* telefone

Exemplo:
nome,telefone
João Silva,5548999999999
Maria Souza,5548988888888

Após upload, salvar os leads no banco com status NOVO.

3. Campanha de disparo
   Criar uma tela ou ação para iniciar disparo ativo no WhatsApp.
   Ao iniciar campanha:

* Enviar mensagem inicial personalizada para cada lead
* Atualizar status para CONTATADO
* Registrar a mensagem no histórico

Mensagem exemplo:
"Olá {{nome}}, tudo bem? Vi que você demonstrou interesse em soluções de IA para automação comercial. Posso te fazer algumas perguntas rápidas para entender se faz sentido?"

Importante:
Criar uma camada de serviço para WhatsApp com duas implementações:

* mock, para rodar localmente sem API real
* cloud-api, preparada para WhatsApp Cloud API oficial

4. Webhook de respostas
   Criar endpoint para receber resposta do WhatsApp.
   Quando o lead responder:

* Salvar mensagem no histórico
* Enviar a conversa para o agente de IA
* A IA deve decidir próxima pergunta ou qualificação
* Atualizar score e status do lead
* Se necessário, responder automaticamente no WhatsApp

5. Agente de qualificação com IA
   Criar um serviço de IA que analise a conversa e extraia:

* Interesse do lead
* Dor principal
* Segmento
* Se é decisor
* Urgência
* Orçamento aproximado
* Melhor horário para reunião
* Resumo da conversa
* Próxima ação recomendada

A IA deve retornar JSON estruturado.

Exemplo de retorno:
{
"interestLevel": "alto",
"painPoint": "perde muitos leads no WhatsApp",
"isDecisionMaker": true,
"urgency": "alta",
"budget": "acima de 3000",
"preferredMeetingTime": "amanhã à tarde",
"score": 85,
"summary": "Lead tem alto volume de atendimento e quer automatizar vendas.",
"nextAction": "schedule_meeting"
}

6. Pipeline comercial
   Criar os seguintes status:

* NOVO
* CONTATADO
* EM_CONVERSA
* QUALIFICADO
* REUNIAO_AGENDADA
* DESCARTADO

Regras:

* Lead recém importado: NOVO
* Mensagem enviada: CONTATADO
* Lead respondeu: EM_CONVERSA
* Score >= 70: QUALIFICADO
* Reunião criada: REUNIAO_AGENDADA
* Score < 40 após conversa: DESCARTADO

7. Agendamento automático
   Quando o lead atingir score >= 70:

* Verificar disponibilidade no calendário
* Sugerir horários
* Se o lead aceitar um horário, criar evento
* Atualizar lead para REUNIAO_AGENDADA
* Enviar confirmação no WhatsApp

Criar serviço de calendário com duas implementações:

* mock, para teste local
* google-calendar, preparado para API real

8. Banco de dados
   Criar schema Prisma com entidades:

* Lead
* Message
* Campaign
* Meeting
* Qualification

Relacionamentos:

* Lead possui várias mensagens
* Lead pode ter uma qualificação
* Lead pode ter uma reunião
* Campaign possui vários leads

9. Arquitetura
   Organizar o projeto em camadas:

* app / rotas e páginas
* components / UI
* server / services
* server / ai
* server / whatsapp
* server / calendar
* server / db
* lib / utils

10. README
    Criar um README profissional explicando:

* Objetivo do projeto
* Fluxo da solução
* Arquitetura
* Como rodar localmente
* Variáveis de ambiente
* Como trocar mock por API real
* Próximos passos para produção
* Pontos de escalabilidade

11. Escalabilidade e visão de Head de IA
    No README, incluir uma seção chamada "Decisões de arquitetura para produção", explicando:

* Uso futuro de filas para disparos em massa
* Rate limit do WhatsApp
* Retry em falhas
* Logs e observabilidade
* Human handoff para atendimento humano
* Controle de opt-in e LGPD
* Métricas de conversão
* Custo por lead qualificado
* Separação entre IA barata para classificação e IA mais forte para decisões complexas

Modo de trabalho:
Primeiro, não gere código.
Comece me mostrando:

1. Arquitetura geral
2. Estrutura de pastas
3. Modelagem do banco
4. Fluxo completo do usuário
5. Endpoints necessários
6. Plano de implementação por etapas

Depois que eu aprovar, implemente passo a passo.
Não crie uma solução superficial. Quero um MVP apresentável, com boa arquitetura, boa UI e README forte.
Show less
I'll start by checking the current state of the working directory, then design the architecture.

Globpattern: "**/*"
No files found
Directory is empty — this is a greenfield build, so there's no existing code to explore. The spec is detailed and clear. Before I write the final plan, I need to lock down a few decisions that genuinely change the architecture.

AskUserQuestion
OUT
Your questions have been answered: "Qual provider de IA devo usar como padrão? (O requisito 11 pede 'IA barata para classificação + IA forte para decisões' — vou modelar isso com dois tiers de modelo dentro do provider escolhido.)"="Anthropic (Claude)", "Como devo provisionar o PostgreSQL para o avaliador rodar localmente?"="Docker Compose", "Como o lead deve confirmar/escolher o horário da reunião no fluxo de agendamento?"="IA sugere e lead aceita por texto". You can now continue with these answers in mind.
Empty directory confirmed — pure greenfield. Decisions locked: Anthropic (Haiku para classificação + Sonnet para decisões), Docker Compose para Postgres, agendamento conversacional (IA sugere, lead aceita por texto). Now writing the plan.

Write C:\Users\Matheus\.claude\plans\voc-um-arquiteto-eager-quiche.md
248 lines
# Mini CRM de Prospecção com IA — Plano de Implementação

## Context

Teste técnico para vaga de **Head de IA**: construir um MVP funcional de uma plataforma onde o cliente sobe uma lista de leads (nome + telefone), dispara mensagens ativas no WhatsApp, conversa com cada lead, qualifica automaticamente com IA, move o lead num pipeline comercial e agenda reunião quando qualificado.

O objetivo não é só "funcionar", é **ser apresentável**: arquitetura em camadas bem desacoplada, UI limpa, modo mock para rodar localmente sem nenhuma credencial externa, e um README que demonstre visão de produção (filas, rate limit, observabilidade, LGPD, custo por lead qualificado, tiering de modelos).

**Decisões já fechadas com o usuário:**
- **IA:** Anthropic. Dois tiers — `claude-haiku-4-5` (classificação/próxima pergunta, barato) e `claude-sonnet-4-6` (qualificação estruturada / decisões). Atende diretamente o requisito 11.
- **Postgres:** via Docker Compose (reprodutível, zero conta externa).
- **Agendamento:** conversacional — a IA sugere 2-3 horários no WhatsApp e o lead aceita por texto; a IA interpreta a escolha e cria o evento.
- **Modo padrão:** `mock` para WhatsApp e Calendar, para o avaliador rodar tudo localmente sem credenciais. Implementações `cloud-api` / `google-calendar` ficam prontas e selecionáveis por env.

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
3. **Agente de qualificação** (Sonnet, JSON estruturado via tool-use forçado) analisa a conversa inteira → produz o JSON de qualificação → upsert em `Qualification`.
4. **Regras de pipeline** aplicadas pelo score (state machine em `pipeline.ts`).
5. Decisão de próxima ação:
   - `score >= 70` ou `nextAction = schedule_meeting` → entra no subfluxo de agendamento.
   - senão → **agente de conversa** (Haiku) gera a próxima pergunta e responde via WhatsApp.
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
    │   │   ├── prompts.ts · schemas.ts  # zod + JSON schema (tool-use)
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
  score               Int     @default(0)
  summary             String?
  nextAction          String?
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

Relacionamentos: Lead 1‑N Message; Lead 1‑1 Qualification; Lead 1‑1 Meeting; Campaign 1‑N Lead. (Para o MVP, MVP usa `prisma db push`; migrations versionadas ficam como nota de produção no README.)

---

## 4. Fluxo completo do usuário

1. **Importar leads** — Dashboard → "Importar CSV" → sobe `nome,telefone` → `lib/csv` parseia, `lib/phone` normaliza para E.164 → leads salvos como `NOVO` (dedupe por telefone).
2. **Criar campanha** — define nome + template (`Olá {{nome}}...`) e associa os leads `NOVO`.
3. **Iniciar disparo** — botão "Iniciar campanha" → para cada lead: renderiza template, `whatsApp.sendMessage()`, salva `Message(OUTBOUND)`, move para `CONTATADO`. No modo mock, a mensagem é logada e aparece na conversa.
4. **Lead responde** — no real, via webhook; no mock, o avaliador usa o input "responder como lead" na tela de conversa (chama `/api/dev/simulate-reply` → mesmo webhook).
5. **IA qualifica** — `conversation.service` roda o agente, atualiza `Qualification` + score, aplica regras de pipeline e responde (próxima pergunta) automaticamente. Lead vai para `EM_CONVERSA`.
6. **Qualificação** — score ≥ 70 → `QUALIFICADO`; a IA passa a propor horários.
7. **Agendamento** — IA sugere slots (Calendar service) → lead aceita por texto → evento criado → `REUNIAO_AGENDADA` → confirmação enviada no WhatsApp.
8. **Descarte** — score < 40 após conversa → `DESCARTADO`.
9. Tudo visível em tempo n­ear-real no Dashboard (tabela + kanban, com polling leve).

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
6. **Camada de IA** — `provider.ts` (Anthropic, MODELS.cheap/strong); `schemas.ts` (zod + JSON schema p/ tool-use forçado); `qualification.agent` (Sonnet) e `conversation.agent` (Haiku); `prompts.ts`.
7. **Webhook + orquestração** — `conversation.service` (dedupe, salva, `EM_CONVERSA`, roda qualificação, aplica `pipeline.ts`, responde); `/api/webhooks/whatsapp` (GET+POST) e `/api/dev/simulate-reply`.
8. **Camada Calendar + agendamento** — `types/mock/google-calendar/index`; `scheduling.service` (disponibilidade → propõe → interpreta aceite → cria evento → `REUNIAO_AGENDADA` → confirma).
9. **Polish de UI/pipeline** — kanban arrastável de leitura, badges de status/score, coluna última mensagem, polling, estados de loading/erro, responsividade.
10. **README + produção** — README forte (objetivo, fluxo, arquitetura, como rodar, env, mock↔real, próximos passos) + seção **"Decisões de arquitetura para produção"** cobrindo filas, rate limit do WhatsApp, retry, observabilidade, human handoff, opt-in/LGPD, métricas de conversão, custo por lead qualificado e separação IA barata×forte.

---

## Verificação (end-to-end, 100% local em mock)

1. `docker compose up -d` → `npm install` → `npx prisma db push` → `npm run seed` → `npm run dev`.
2. Abrir Dashboard, importar `public/sample-leads.csv` → leads aparecem como `NOVO`.
3. Criar campanha, clicar "Iniciar" → leads viram `CONTATADO`, mensagem inicial visível na conversa.
4. Abrir um lead, usar "responder como lead" algumas vezes → observar IA qualificando, score subindo, status `EM_CONVERSA` → `QUALIFICADO`.
5. Continuar → IA propõe horários, aceitar um → evento criado (mock), status `REUNIAO_AGENDADA`, confirmação na conversa.
6. Testar caminho de descarte (respostas desinteressadas) → `DESCARTADO`.
7. (Opcional) teste unitário de `pipeline.ts` — função pura de transição por score.
8. Conferir que setar `WHATSAPP_MODE=cloud-api` / `CALENDAR_MODE=google-calendar` carrega as implementações reais sem tocar no código de domínio.

## Dependências principais
`next@15`, `react`, `typescript`, `tailwindcss`, `prisma` + `@prisma/client`, `@anthropic-ai/sdk`, `zod`, `papaparse` (CSV), `googleapis` (Calendar real), `lucide-react` (ícones). WhatsApp Cloud API via `fetch` (Graph API), sem SDK extra.
O plano está completo e cobre exatamente as 6 entregas que você pediu (arquitetura geral, estrutura de pastas, modelagem do banco, fluxo do usuário, endpoints e plano por etapas), além de contexto e verificação. As decisões que travamos: Anthropic com dois tiers (Haiku para classificação + Sonnet para decisões), Postgres via Docker Compose, agendamento conversacional, e modo mock como padrão para rodar 100% local sem credenciais.

Destaques de arquitetura pensados para o teste de Head de IA:

WhatsApp e Calendar como interfaces resolvidas por factory via env — trocar mock↔real é só mudar uma variável, zero mudança no código de negócio.
Regras de pipeline isoladas numa state machine pura (pipeline.ts), testável.
Tiering de modelos atendendo diretamente o requisito 11.
Webhook idempotente (dedupe por providerMessageId) e endpoint de simulação para demo local do loop completo.
Claude’s Plan C:\Users\Matheus\.claude\plans\voc-um-arquiteto-eager-quiche.md
User approved the plan
Plano aprovado. Vou montar a lista de tarefas e começar a implementação pela infraestrutura.

c:\Users\Matheus\.claude\plans\voc-um-arquiteto-eager-quiche.md
como consigo marcar o plano em outro chat?
O plano ficou salvo num arquivo no seu disco, então você consegue acessá-lo de qualquer chat. Ele está em:

C:\Users\Matheus\.claude\plans\voc-um-arquiteto-eager-quiche.md

Algumas formas de usar em outra conversa:

1. Referenciar o arquivo direto
Num chat novo, é só pedir:

"Leia o plano em C:\Users\Matheus\.claude\plans\voc-um-arquiteto-eager-quiche.md e continue a implementação a partir da etapa X"

O Claude lê o arquivo e segue de onde parou.

2. Renomear para um nome mais fácil (opcional)
O nome atual é gerado automaticamente. Se quiser, posso copiar para algo como plano-crm-ia.md na própria pasta do projeto (c:\Users\Matheus\Documents\WORK\teste-crm\PLANO.md), aí fica versionado junto com o código e fácil de achar.

3. Skill executing-plans
Existe uma skill chamada /executing-plans feita exatamente para retomar um plano escrito em outra sessão com checkpoints de revisão. Em um chat novo você pode invocá-la apontando para o arquivo.

Quer que eu faça uma dessas agora? Por exemplo, posso copiar o plano para dentro do projeto (teste-crm/PLANO.md) para ele ficar junto do código — aí em qualquer chat você só abre a pasta do projeto e o plano já está lá. Ou, se preferir, sigo direto com a implementação que já foi aprovada.

Como quer seguir?


image.png
387×853
nao vejo ele
Exato — o plano não está dentro da pasta do projeto. Ele foi salvo numa pasta do sistema (C:\Users\Matheus\.claude\plans\), por isso o Explorer do VS Code (que mostra só a pasta TESTE-CRM) aparece vazio.

Vou copiar o plano para dentro do projeto agora, assim ele aparece no Explorer e fica acessível de qualquer chat que abra essa pasta.

Read C:\Users\Matheus\.claude\plans\voc-um-arquiteto-eager-quiche.md
Write c:\Users\Matheus\Documents\WORK\teste-crm\PLANO.md
248 lines
# Mini CRM de Prospecção com IA — Plano de Implementação

## Context

Teste técnico para vaga de **Head de IA**: construir um MVP funcional de uma plataforma onde o cliente sobe uma lista de leads (nome + telefone), dispara mensagens ativas no WhatsApp, conversa com cada lead, qualifica automaticamente com IA, move o lead num pipeline comercial e agenda reunião quando qualificado.

O objetivo não é só "funcionar", é **ser apresentável**: arquitetura em camadas bem desacoplada, UI limpa, modo mock para rodar localmente sem nenhuma credencial externa, e um README que demonstre visão de produção (filas, rate limit, observabilidade, LGPD, custo por lead qualificado, tiering de modelos).

**Decisões já fechadas com o usuário:**
- **IA:** Anthropic. Dois tiers — `claude-haiku-4-5` (classificação/próxima pergunta, barato) e `claude-sonnet-4-6` (qualificação estruturada / decisões). Atende diretamente o requisito 11.
- **Postgres:** via Docker Compose (reprodutível, zero conta externa).
- **Agendamento:** conversacional — a IA sugere 2-3 horários no WhatsApp e o lead aceita por texto; a IA interpreta a escolha e cria o evento.
- **Modo padrão:** `mock` para WhatsApp e Calendar, para o avaliador rodar tudo localmente sem credenciais. Implementações `cloud-api` / `google-calendar` ficam prontas e selecionáveis por env.

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
3. **Agente de qualificação** (Sonnet, JSON estruturado via tool-use forçado) analisa a conversa inteira → produz o JSON de qualificação → upsert em `Qualification`.
4. **Regras de pipeline** aplicadas pelo score (state machine em `pipeline.ts`).
5. Decisão de próxima ação:
   - `score >= 70` ou `nextAction = schedule_meeting` → entra no subfluxo de agendamento.
   - senão → **agente de conversa** (Haiku) gera a próxima pergunta e responde via WhatsApp.
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
    │   │   ├── prompts.ts · schemas.ts  # zod + JSON schema (tool-use)
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
  score               Int     @default(0)
  summary             String?
  nextAction          String?
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
4. **Lead responde** — no real, via webhook; no mock, o avaliador usa o input "responder como lead" na tela de conversa (chama `/api/dev/simulate-reply` → mesmo webhook).
5. **IA qualifica** — `conversation.service` roda o agente, atualiza `Qualification` + score, aplica regras de pipeline e responde (próxima pergunta) automaticamente. Lead vai para `EM_CONVERSA`.
6. **Qualificação** — score ≥ 70 → `QUALIFICADO`; a IA passa a propor horários.
7. **Agendamento** — IA sugere slots (Calendar service) → lead aceita por texto → evento criado → `REUNIAO_AGENDADA` → confirmação enviada no WhatsApp.
8. **Descarte** — score < 40 após conversa → `DESCARTADO`.
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
6. **Camada de IA** — `provider.ts` (Anthropic, MODELS.cheap/strong); `schemas.ts` (zod + JSON schema p/ tool-use forçado); `qualification.agent` (Sonnet) e `conversation.agent` (Haiku); `prompts.ts`.
7. **Webhook + orquestração** — `conversation.service` (dedupe, salva, `EM_CONVERSA`, roda qualificação, aplica `pipeline.ts`, responde); `/api/webhooks/whatsapp` (GET+POST) e `/api/dev/simulate-reply`.
8. **Camada Calendar + agendamento** — `types/mock/google-calendar/index`; `scheduling.service` (disponibilidade → propõe → interpreta aceite → cria evento → `REUNIAO_AGENDADA` → confirma).
9. **Polish de UI/pipeline** — kanban de leitura, badges de status/score, coluna última mensagem, polling, estados de loading/erro, responsividade.
10. **README + produção** — README forte (objetivo, fluxo, arquitetura, como rodar, env, mock↔real, próximos passos) + seção **"Decisões de arquitetura para produção"** cobrindo filas, rate limit do WhatsApp, retry, observabilidade, human handoff, opt-in/LGPD, métricas de conversão, custo por lead qualificado e separação IA barata×forte.

---

## Verificação (end-to-end, 100% local em mock)

1. `docker compose up -d` → `npm install` → `npx prisma db push` → `npm run seed` → `npm run dev`.
2. Abrir Dashboard, importar `public/sample-leads.csv` → leads aparecem como `NOVO`.
3. Criar campanha, clicar "Iniciar" → leads viram `CONTATADO`, mensagem inicial visível na conversa.
4. Abrir um lead, usar "responder como lead" algumas vezes → observar IA qualificando, score subindo, status `EM_CONVERSA` → `QUALIFICADO`.
5. Continuar → IA propõe horários, aceitar um → evento criado (mock), status `REUNIAO_AGENDADA`, confirmação na conversa.
6. Testar caminho de descarte (respostas desinteressadas) → `DESCARTADO`.
7. (Opcional) teste unitário de `pipeline.ts` — função pura de transição por score.
8. Conferir que setar `WHATSAPP_MODE=cloud-api` / `CALENDAR_MODE=google-calendar` carrega as implementações reais sem tocar no código de domínio.

## Dependências principais
`next@15`, `react`, `typescript`, `tailwindcss`, `prisma` + `@prisma/client`, `@anthropic-ai/sdk`, `zod`, `papaparse` (CSV), `googleapis` (Calendar real), `lucide-react` (ícones). WhatsApp Cloud API via `fetch` (Graph API), sem SDK extra.
Pronto! Criei o arquivo PLANO.md dentro da pasta do projeto (teste-crm). Ele já deve aparecer no Explorer do VS Code — talvez precise clicar no ícone de refresh do Explorer, ou fechar/reabrir a pasta.

Agora você tem o plano em dois lugares:

c:\Users\Matheus\Documents\WORK\teste-crm\PLANO.md ← novo, dentro do projeto (visível no Explorer)
C:\Users\Matheus\.claude\plans\voc-um-arquiteto-eager-quiche.md ← original
Para usar em outro chat, é só abrir esta pasta (teste-crm) no VS Code e pedir:

"Leia o PLANO.md e continue a implementação a partir da etapa X"

Quer que eu comece a implementação agora (etapa 1 — scaffold do Next.js + Docker + Prisma)? Posso seguir direto.