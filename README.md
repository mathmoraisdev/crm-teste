# Mini CRM de Prospecção com IA

MVP de uma plataforma onde o cliente sobe uma lista de leads (nome + telefone),
dispara mensagens ativas no WhatsApp, conversa com cada lead, **qualifica
automaticamente com IA**, move o lead num pipeline comercial e **agenda reunião**
quando qualificado — tudo de forma conversacional.

> **Roda 100% local.** WhatsApp e Google Calendar têm modo **mock** (sem conta
> Meta/Google). A única credencial obrigatória é a `ANTHROPIC_API_KEY` — a IA é
> o núcleo do produto e é sempre real.

---

## Como rodar

Pré-requisitos: **Node 18+**, **Docker** (para o Postgres) e uma
`ANTHROPIC_API_KEY`.

```bash
# 1. Variáveis de ambiente
cp .env.example .env        # preencha ANTHROPIC_API_KEY

# 2. Banco (Postgres 16 via Docker)
docker compose up -d

# 3. Dependências + schema + dados de exemplo
npm install
npm run db:push             # cria as tabelas (prisma db push)
npm run seed                # 1 campanha + 6 leads de exemplo

# 4. App
npm run dev                 # http://localhost:3000
```

### Roteiro de demonstração (mock)

1. **Importar leads** — em *Leads*, “Importar CSV” → use
   [`public/sample-leads.csv`](public/sample-leads.csv). Entram como **Novo**
   (telefones normalizados para E.164; duplicados ignorados).
2. **Criar e iniciar campanha** — em *Campanhas*, crie uma (template com
   `{{nome}}`) e clique **Iniciar**. Os leads viram **Contatado** e a mensagem
   inicial aparece na conversa.
3. **Conversar como o lead** — abra um lead e use *“responder como o lead”*.
   A IA lê a conversa, **qualifica** (score sobe), responde a próxima pergunta e
   move o status (**Em conversa → Qualificado**).
4. **Agendar** — ao qualificar, a IA propõe horários no chat; responda escolhendo
   um → evento criado (mock) e status **Reunião agendada**.
5. **Descarte** — respostas claramente desinteressadas levam a **Descartado**.

O dashboard atualiza sozinho (polling leve) em **tabela** ou **kanban**.

### Testes

```bash
npm test    # teste unitário da state machine de pipeline (função pura)
```

---

## Fluxo do agente de IA

Cada mensagem inbound passa pela orquestração em
[`conversation.service.ts`](src/server/services/conversation.service.ts):

1. **Dedupe** por `providerMessageId` → salva `Message(INBOUND)`.
2. Lead `NOVO`/`CONTATADO` → `EM_CONVERSA`.
3. Se há reunião **proposta**, a IA interpreta a **escolha de horário** e agenda.
4. Senão: **agente de qualificação** (Sonnet, JSON estruturado via tool-use) →
   `Qualification` + score.
5. **Regras de pipeline** ([`pipeline.ts`](src/server/services/pipeline.ts),
   função pura): `score ≥ 70` ou `schedule_meeting` → **Qualificado** (propõe
   horários); `score < 40` **e** desinteresse explícito → **Descartado**; senão
   **agente de conversa** (Haiku) gera a próxima pergunta.

**Tiering de modelos** (requisito atendido): Haiku (`AI_MODEL_CHEAP`) para
classificação/próxima pergunta; Sonnet (`AI_MODEL_STRONG`) para a qualificação
estruturada e decisões.

---

## Arquitetura

Next.js 15 (App Router) full-stack. Toda regra de negócio vive em `server/`; as
rotas só validam input e delegam aos services.

```
UI (app/ + components/)
   └─ Route Handlers (app/api/*)  — validação zod + delegação
        └─ server/services         — orquestração de domínio
             ├─ pipeline.ts (state machine pura, testada)
             ├─ server/ai          — Anthropic, 2 tiers (Haiku/Sonnet)
             ├─ server/whatsapp     — interface · mock | cloud-api  (factory por env)
             └─ server/calendar     — interface · mock | google-calendar (factory por env)
```

**Princípio central:** WhatsApp e Calendar são *interfaces* resolvidas por
factory (`WHATSAPP_MODE` / `CALENDAR_MODE`). Os services dependem da interface,
nunca da implementação — trocar mock → real é **uma env var, zero mudança de
código de negócio**.

### Modelo de dados (Prisma)

`Lead` 1‑N `Message` · `Lead` 1‑1 `Qualification` · `Lead` 1‑1 `Meeting` ·
`Campaign` 1‑N `Lead`. Status do lead:
`NOVO → CONTATADO → EM_CONVERSA → QUALIFICADO → REUNIAO_AGENDADA` (ou
`DESCARTADO`). Para o MVP usa `prisma db push`; migrations versionadas ficam como
nota de produção (abaixo).

---

## Configuração (env)

| Variável | Default | Observação |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Obrigatória.** Núcleo do produto. |
| `AI_MODEL_CHEAP` | `claude-haiku-4-5` | Classificação / próxima pergunta. |
| `AI_MODEL_STRONG` | `claude-sonnet-4-6` | Qualificação estruturada / decisões. |
| `WHATSAPP_MODE` | `mock` | `cloud-api` exige `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`. |
| `CALENDAR_MODE` | `mock` | `google-calendar` exige `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`. |
| `SCHEDULING_TIMEZONE` | `America/Sao_Paulo` | Fuso para propor horários. |

### Mock ↔ real

- **WhatsApp real:** `WHATSAPP_MODE=cloud-api` + token/phone id (Meta Graph API).
  O webhook `GET /api/webhooks/whatsapp` faz a verificação (`hub.challenge`); o
  `POST` recebe inbounds. Nenhum código de domínio muda.
- **Google Calendar real:** `CALENDAR_MODE=google-calendar` + credenciais de
  service account. `freebusy` filtra horários ocupados; o evento é criado com
  link do Meet.

---

## Decisões de arquitetura para produção

O MVP foi desenhado pensando no caminho de produção. O que mudaria:

- **Filas & assíncrono.** O disparo de campanha e o loop de IA hoje são
  síncronos no request. Em produção: fila (SQS/BullMQ) com workers, para
  paralelizar disparos e isolar a latência da IA do request HTTP.
- **Rate limit do WhatsApp.** A Cloud API tem limites por número/tier — um
  token-bucket por número e backoff respeitando os erros 429/4xx da Graph API.
- **Retry & idempotência.** Reentrega de webhook já é tratada por dedupe
  (`providerMessageId @unique`); somar retry com backoff nos envios e DLQ para
  falhas persistentes.
- **Observabilidade.** Logs estruturados + tracing por lead/conversa, métricas
  de funil (conversão por etapa) e **custo por lead qualificado** (tokens ×
  preço por tier).
- **Human handoff.** Sinalizar quando a IA não deve decidir sozinha (objeções
  complexas, alto ticket) e passar a conversa para um humano.
- **LGPD / opt-in.** Registrar consentimento, honrar opt-out (“pare”) e ter
  política de retenção/anonimização dos dados de conversa.
- **IA barata × forte.** Já implementado (Haiku × Sonnet). Em escala: caching de
  prompt, batching de classificações e fallback de modelo.
- **Migrations versionadas.** Trocar `db push` por `prisma migrate` com histórico
  versionado e revisão em PR.

---

## Estrutura

```
src/
├── app/                      # páginas + route handlers (API)
│   ├── leads/ · campaigns/   # dashboard, detalhe, campanhas
│   └── api/                  # leads, campaigns, webhooks/whatsapp, dev/simulate-reply
├── components/               # UI (tabela, kanban, conversa, qualificação, formulários)
├── server/
│   ├── ai/                   # provider (Anthropic) + agentes + schemas + prompts
│   ├── whatsapp/             # types · mock · cloud-api · index (factory)
│   ├── calendar/             # types · mock · google-calendar · index (factory)
│   ├── services/             # lead · campaign · conversation · qualification · scheduling · pipeline
│   └── db/                   # PrismaClient singleton
└── lib/                      # csv · phone · env (zod) · utils · leadStatus
```
