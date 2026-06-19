# Mini CRM de Prospecção com IA

MVP de uma plataforma onde o cliente sobe uma lista de leads (nome + telefone),
dispara mensagens ativas no WhatsApp, conversa com cada lead, **qualifica
automaticamente com IA**, move o lead num pipeline comercial e **agenda reunião**
quando qualificado — tudo de forma conversacional.

> **Roda 100% local.** WhatsApp e Google Calendar têm modo **mock** (sem conta
> Meta/Google). A única credencial obrigatória é a `OPENAI_API_KEY` — a IA é
> o núcleo do produto e é sempre real.

---

## Como rodar

Pré-requisitos: **Node 20.12+** (o worker carrega o `.env` via
`--env-file-if-exists`), **Docker** (para o Postgres) e uma `OPENAI_API_KEY`.

```bash
# 1. Variáveis de ambiente
cp .env.example .env        # preencha OPENAI_API_KEY

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
npm test                 # suíte determinística (sem rede, sem custo)
```

A suíte cobre as funções puras de cada camada: state machine de pipeline,
validação das saídas da IA + **espelho zod ↔ JSON Schema**, formatação de
transcript, opt-out, pacing/cap/reaper do worker, seleção de chip e sinais de
ban do Baileys.

**Evals dos agentes de IA** (chamam a OpenAI de verdade, então são opt-in):

```bash
RUN_AI_EVALS=1 npm test -- src/server/ai/agents.eval.test.ts
```

Avaliam comportamento por *faixa* (não valor exato, já que LLM não é
determinístico): lead quente não é descartado e pontua alto; lead que pede para
parar vira `discard`; lead novo continua em qualificação; e-mail é capturado
quando dado e nunca inventado; e a interpretação de horário acerta número,
descrição e recusa ambíguos. Sem `RUN_AI_EVALS`/`OPENAI_API_KEY` o bloco é
pulado e o `npm test` segue verde.

---

## Fluxo do agente de IA

Cada mensagem inbound passa pela orquestração em
[`conversation.service.ts`](src/server/services/conversation.service.ts):

1. **Dedupe** por `providerMessageId` → salva `Message(INBOUND)`.
2. Lead `NOVO`/`CONTATADO` → `EM_CONVERSA`.
3. Se há reunião **proposta**, a IA interpreta a **escolha de horário** e agenda.
4. Senão: **agente de qualificação** (gpt-4o, JSON estruturado via function
   calling) → `Qualification` + score.
5. **Regras de pipeline** ([`pipeline.ts`](src/server/services/pipeline.ts),
   função pura): `score ≥ 70` ou `schedule_meeting` → **Qualificado** (propõe
   horários); `score < 40` **e** desinteresse explícito → **Descartado**; senão
   **agente de conversa** (gpt-4o-mini) gera a próxima pergunta.

**Tiering de modelos** (requisito atendido): gpt-4o-mini (`AI_MODEL_CHEAP`) para
classificação/próxima pergunta; gpt-4o (`AI_MODEL_STRONG`) para a qualificação
estruturada e decisões.

**Saída estruturada confiável.** A qualificação e a escolha de horário usam
*function calling forçado* (`tool_choice`) — o modelo só pode responder chamando
a tool, no formato certo. O contrato é mantido em **dois espelhos** em
[`schemas.ts`](src/server/ai/schemas.ts): o JSON Schema (vai na tool, restringe a
geração) e o zod (valida em runtime o que voltou). Um teste de consistência
garante que os dois não derivem. A IA propõe; quem **decide** é a state machine
pura ([`pipeline.ts`](src/server/services/pipeline.ts)) — limiares de negócio
ficam em código testável, não no prompt.

---

## Arquitetura

Next.js 15 (App Router) full-stack. Toda regra de negócio vive em `server/`; as
rotas só validam input e delegam aos services.

```
UI (app/ + components/)
   └─ Route Handlers (app/api/*)  — validação zod + delegação
        └─ server/services         — orquestração de domínio
             ├─ pipeline.ts (state machine pura, testada)
             ├─ server/ai          — OpenAI, 2 tiers (gpt-4o-mini/gpt-4o)
             ├─ server/whatsapp     — interface · mock | cloud-api | baileys  (factory por env)
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
| `OPENAI_API_KEY` | — | **Obrigatória.** Núcleo do produto. |
| `AI_MODEL_CHEAP` | `gpt-4o-mini` | Classificação / próxima pergunta. |
| `AI_MODEL_STRONG` | `gpt-4o` | Qualificação estruturada / decisões. |
| `WHATSAPP_MODE` | `mock` | `cloud-api` exige `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`; `baileys` = transporte não-oficial multi-número (ver [Caminho B](#caminho-b--baileys-multi-número-não-oficial)). |
| `CALENDAR_MODE` | `mock` | `google-calendar` exige `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`. |
| `SCHEDULING_TIMEZONE` | `America/Sao_Paulo` | Fuso para propor horários e para a janela de envio. |
| `WHATSAPP_DAILY_CAP` / `WHATSAPP_MIN_INTERVAL_MS` / `WHATSAPP_JITTER_MS` | `1000` / `8000` / `4000` | Cap diário (warm-up), intervalo e jitter do worker. |
| `WHATSAPP_SEND_START_HOUR` / `WHATSAPP_SEND_END_HOUR` | `9` / `18` | Janela comercial de envio (fim exclusivo). |
| `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG` | `""` / `pt_BR` | Template aprovado p/ cold outbound. |
| `WHATSAPP_APP_SECRET` | `""` | Valida a assinatura `X-Hub-Signature-256` do webhook. |
| `WORKER_POLL_MS` | `2000` | Frequência de polling do worker quando a fila está vazia. |
| `BAILEYS_AUTH_DIR` | `.baileys-auth` | Pasta-base das sessões (1 subpasta por chip). **Nunca commitar.** |
| `BAILEYS_PER_NUMBER_DAILY_CAP` | `30` | Teto diário **por chip** no warm-up (suba devagar). |
| `BAILEYS_ONWHATSAPP_CHECK` | `true` | Verifica `onWhatsApp` antes de enviar (pula número inexistente). |
| `BAILEYS_TYPING_MS_PER_CHAR` / `BAILEYS_TYPING_MAX_MS` | `55` / `9000` | Simulação humana de digitação (proporcional + teto). |

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

- **Filas & assíncrono.** O disparo de campanha já é **assíncrono**: `startCampaign`
  enfileira um `OutboundJob` por lead (tabela Postgres) e um **worker** separado
  (`npm run worker`) consome a fila — ver [Camada de deliverability](#camada-de-deliverability-disparo-seguro).
  O loop de IA do inbound segue síncrono no request; em escala maior, isolar
  também isso atrás de fila (SQS/BullMQ). Trocar a fila Postgres por BullMQ+Redis
  quando o volume justificar concorrência/retry mais sofisticados.
- **Rate limit do WhatsApp.** Já implementado no worker: intervalo mínimo +
  jitter, janela de horário comercial e cap diário (warm-up). Em escala:
  token-bucket por número e backoff respeitando os erros 429/4xx da Graph API.
- **Retry & idempotência.** Reentrega de webhook já é tratada por dedupe
  (`providerMessageId @unique`); somar retry com backoff nos envios e DLQ para
  falhas persistentes.
- **Observabilidade.** Logs estruturados + tracing por lead/conversa, métricas
  de funil (conversão por etapa) e **custo por lead qualificado** (tokens ×
  preço por tier).
- **Human handoff.** Sinalizar quando a IA não deve decidir sozinha (objeções
  complexas, alto ticket) e passar a conversa para um humano.
- **LGPD / opt-in.** Opt-out automático já implementado (inbound “PARAR/SAIR/STOP”
  → lead `DESCARTADO` + jobs pendentes cancelados); falta registrar a base de
  consentimento (`consentSource`) e a política de retenção/anonimização.
- **IA barata × forte.** Já implementado (gpt-4o-mini × gpt-4o). Em escala: caching de
  prompt, batching de classificações e fallback de modelo.
- **Migrations versionadas.** Trocar `db push` por `prisma migrate` com histórico
  versionado e revisão em PR.

---

## Camada de deliverability (disparo seguro)

Disparo de ~1.000 mensagens/dia via Cloud API oficial sem o número cair. O
`startCampaign` **não envia mais em loop**: enfileira um `OutboundJob` por lead e
um worker dedicado consome a fila respeitando rate limit, janela e cap.

### Worker de disparo

```bash
npm run worker     # consome a fila OutboundJob (funciona em mock também)
```

O worker é um **processo separado e persistente** (loop com polling) — por isso
**não roda em Vercel serverless**, que não segura um loop de fila longo. Em
produção, hospede-o num serviço de processo persistente (**Railway/Render/Fly**),
ou troque o loop por **cron/QStash** chamando uma rota de processamento.

A cada ciclo o worker: pula leads em opt-out, respeita o **intervalo mínimo +
jitter** (`WHATSAPP_MIN_INTERVAL_MS`/`WHATSAPP_JITTER_MS`), só envia dentro da
**janela comercial** (`WHATSAPP_SEND_START_HOUR`–`WHATSAPP_SEND_END_HOUR`, fuso
`SCHEDULING_TIMEZONE`), para ao atingir o **cap diário** (`WHATSAPP_DAILY_CAP`) e
ignora campanhas `PAUSED` (gate de qualidade). O cold outbound usa **template
aprovado** (`WHATSAPP_TEMPLATE_NAME`); respostas dentro da janela de 24h seguem
em texto livre pelo caminho reativo.

### Warm-up

Número novo começa no tier 250. Comece com `WHATSAPP_DAILY_CAP` **baixo** (ex.:
`50`) e suba gradualmente até `1000` ao longo de ~2–3 semanas, observando o
**quality rating**. O webhook de qualidade pausa campanhas `RUNNING`
automaticamente se a Meta sinalizar queda (RED/YELLOW/FLAGGED).

### Checklist de go-live (Meta)

- [ ] Conta **Meta Business** com negócio **verificado**.
- [ ] **Número dedicado** que não esteja registrado no app WhatsApp comum.
- [ ] **Display name** aprovado.
- [ ] **Template(s)** de mensagem aprovado(s) (`WHATSAPP_TEMPLATE_NAME`).
- [ ] **Token de sistema permanente** (não o temporário de 24h do painel).
- [ ] Forma de pagamento configurada na WABA (cobrança por conversa).
- [ ] `WHATSAPP_APP_SECRET` setado para validar a assinatura do webhook.

### Caminho B — Baileys multi-número (não-oficial)

Alternativa selecionável por env quando o custo/burocracia da Cloud API não cabe.
**Reaproveita integralmente** a fila `OutboundJob`, o worker (rate-limit/jitter/
janela/cap) e o opt-out — muda só o **transporte**. Toda a lógica pura (spintax,
delay humano, classificação de ban, rotação de número) é testada por unidade; a
cola de socket exige um chip real (smoke manual).

- **Trocar de transporte:** `WHATSAPP_MODE=baileys` (não-oficial, multi-número) ↔
  `cloud-api` (oficial, fallback). O `cloud-api.ts` permanece **intacto** — em
  campanha crítica ou se todos os chips caírem, troca-se a env var (zero mudança
  de código de negócio).
- **Parear chip:** no app, em *Campanhas › Números WhatsApp*, clique **Adicionar
  número** e escaneie o QR (o **worker precisa estar rodando** — é ele que gera o
  QR e o grava em `WhatsAppNumber.pairingQr`, lido pela UI). Alternativa via
  terminal: `npm run wa:link -- "<label>" "<+E164>"`. As sessões ficam em
  `BAILEYS_AUTH_DIR` (uma subpasta por chip) e **não devem ser commitadas** (já
  no `.gitignore`).
- **Rotação + warm-up:** o worker escolhe o chip **conectado menos carregado**
  (espalha a carga) que ainda esteja abaixo do próprio `dailyCap`. Comece cada
  chip baixo (~20–30/dia) e suba ao longo de 2–4 semanas observando quedas/bans.
  **1.000/dia exige múltiplos chips** — o total/dia ≈ soma dos caps, ainda
  limitado pelo `WHATSAPP_DAILY_CAP` global.
- **Anti-spam:** `spintax` (`{oi|olá}`) varia a mensagem por lead; `onWhatsApp`
  pula número inexistente; presença "digitando" + delay proporcional simulam
  comportamento humano.
- **Inbound & acks:** chegam por **evento de socket** (`messages.upsert`) → mesmo
  `handleInbound`; a resposta sai **pelo mesmo chip** que iniciou a conversa
  (`Lead.whatsAppNumberId`). Os acks (`messages.update`) atualizam `Message.status`
  (DELIVERED/READ) — o webhook HTTP só é usado no modo `cloud-api`.
- **Ban / health gate:** substitui o quality-gate da Meta. Logout/403 detectado
  no `connection.update` (401/403) → o número vira `BANNED` e **sai da rotação**;
  os demais seguem enviando. Reponha o chip com `wa:link`.
- **Higiene:** IP estável (evitar datacenter volátil), não re-parear à toa, manter
  o celular-mãe online, **opt-in real** — a taxa de denúncia da lista é o que mais
  derruba número. Nenhuma estrutura garante 100% contra bloqueio.
- **Worker persistente:** o socket Baileys é stateful e vive no processo do worker
  (`npm run worker`) — precisa de processo vivo (**Railway/Render/Fly**); Vercel
  serverless não segura o socket. A UI de *Campanhas* mostra um painel com o
  **status de cada chip** e os **enviados hoje**.

### Banco gerenciado

Para hospedar, trocar `DATABASE_URL` para um **Postgres gerenciado** (Supabase /
Neon / Railway) e migrar de `prisma db push` para **`prisma migrate`** versionado
(com connection pooling para o ambiente serverless).

---

## Estrutura

```
src/
├── app/                      # páginas + route handlers (API)
│   ├── leads/ · campaigns/   # dashboard, detalhe, campanhas
│   └── api/                  # leads, campaigns, webhooks/whatsapp, dev/simulate-reply
├── components/               # UI (tabela, kanban, conversa, qualificação, formulários)
├── server/
│   ├── ai/                   # provider (OpenAI) + agentes + schemas + prompts
│   ├── whatsapp/             # types · mock · cloud-api · index (factory)
│   ├── calendar/             # types · mock · google-calendar · index (factory)
│   ├── services/             # lead · campaign · conversation · qualification · scheduling · pipeline
│   └── db/                   # PrismaClient singleton
└── lib/                      # csv · phone · env (zod) · utils · leadStatus
```
