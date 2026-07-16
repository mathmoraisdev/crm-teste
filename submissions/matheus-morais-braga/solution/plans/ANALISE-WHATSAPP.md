# Análise — Conectar WhatsApp real para disparo (1.000/dia sem cair)

> Documento de decisão. Pré-requisito para hospedar na web + banco gerenciado.
> Objetivo: enviar ~1.000 mensagens ativas/dia com risco mínimo de o número ser
> bloqueado/rebaixado, mantendo a arquitetura em camadas já existente
> (`WhatsAppService` resolvido por `WHATSAPP_MODE`).

---

## 0. TL;DR

- **"Não cair" só existe de verdade no caminho oficial (Cloud API).** No não-oficial
  você só *reduz a probabilidade* de banimento — nunca elimina.
- **1.000/dia é um volume médio-alto de outbound frio.** Em qualquer caminho exige
  **warm-up gradual**, **opt-in**, **opt-out automático** e **rate limiting** — não
  basta trocar uma env var e disparar.
- A implementação atual (`src/server/whatsapp/cloud-api.ts`) é um `sendMessage` cru,
  **sem fila, sem throttle, sem template, sem monitoramento de qualidade**. Essa é a
  lacuna real a fechar antes de produção.
- **Recomendação: Caminho A (Cloud API oficial).**
- **Atualização:** o **Caminho B (Baileys multi-número)** agora está **implementado e
  selecionável** por `WHATSAPP_MODE=baileys`, com uma camada anti-ban (warm-up por
  chip, spintax, simulação humana, `onWhatsApp`, detecção de ban + rotação). A Cloud
  API continua como **fallback** (`cloud-api`). Isso **não muda a recomendação**: B
  reduz a probabilidade de queda, não a elimina — a qualidade do opt-in segue sendo
  responsabilidade operacional. Ver [README → Caminho B](README.md#caminho-b--baileys-multi-número-não-oficial).

---

## 1. Os dois caminhos

### Caminho A — WhatsApp Cloud API oficial (Meta)

O número deixa de existir no app do celular e passa a ser um número de API dentro de
uma **WhatsApp Business Account (WABA)**, sob uma **Meta Business Account** verificada.

| Aspecto | Como funciona |
|---|---|
| Banimento | Não há "ban aleatório". Há **quality rating** (verde/amarelo/vermelho). Qualidade ruim → limite cai → número pode ser suspenso. Recuperável. |
| Outbound frio | **Obrigatório template aprovado** pela Meta (categoria *Marketing* ou *Utility*). Texto livre só na **janela de 24h** após o lead responder. |
| Limite de envio | Por **tier**, em destinatários únicos iniciados pela empresa / 24h: **250 → 1.000 → 10.000 → 100.000 → ilimitado**. Sobe sozinho com volume + qualidade boa. |
| Custo | Cobrança **por conversa/mensagem** (varia por país e categoria; marketing é o mais caro). Brasil tem tarifa própria. Há um nº de conversas de serviço grátis/mês. |
| Pré-requisitos | Meta Business verificada, número dedicado **não registrado no WhatsApp comum**, display name aprovado, templates aprovados. |
| Legalidade | 100% dentro dos Termos. Sustentável e auditável. |

**Para os 1.000/dia:** você precisa alcançar o **tier 1K**. Número novo começa em 250.
O tier sobe automaticamente quando você envia volume consistente mantendo qualidade
alta — daí a importância do warm-up. Atenção também ao **limite de marketing por
usuário** (a Meta limita quantos templates de marketing um mesmo destinatário recebe
num período) — isso afeta reenvios, não o volume total da lista.

### Caminho B — Número não-oficial (Baileys / whatsapp-web.js / Evolution API)

Conecta um número **real do celular** via protocolo do WhatsApp Web (login por QR Code).

| Aspecto | Como funciona |
|---|---|
| Banimento | **Risco real e alto** de banimento **permanente** do número. Disparo ativo frio é exatamente o padrão que os sistemas anti-spam da Meta detectam. |
| Outbound frio | Sem template, texto livre, sem aprovação. Parece 100% humano. |
| Limite de envio | Não há limite "oficial" — o limite é o que o anti-spam tolera. Empiricamente **muito abaixo** de 1.000/dia para número novo. |
| Custo | Sem custo por mensagem (só infra do servidor + Redis/sessão). |
| Pré-requisitos | Um número com chip, servidor persistente segurando a sessão (não pode cair), QR scan. |
| Legalidade | **Viola os Termos da Meta.** Sem SLA, sem suporte, pode quebrar a cada atualização do protocolo. |

**Por que "garantir que não cai" é impossível aqui:** o número é avaliado pelo mesmo
anti-spam, mas sem nenhum dos sinais de legitimidade do caminho oficial (negócio
verificado, opt-in registrado, template). Técnicas de mitigação (warm-up agressivo,
delays grandes, rotação de números) reduzem a taxa de queda, mas a literatura prática
do mercado reporta quedas frequentes em operação de cold outreach a volume.

> **Status de implementação (Caminho B):** ✅ disponível via `WHATSAPP_MODE=baileys`.
> O socket Baileys é stateful e vive no **worker** (pool keyed por `WhatsAppNumber`);
> o Next.js continua só enfileirando. Reaproveita a fila `OutboundJob`, o worker
> (rate-limit/jitter/janela/cap) e o opt-out. Mitigações implementadas: **rotação
> least-loaded + cap por chip** (`WhatsAppNumber.dailyCap`), **spintax** por lead,
> **delay humano** de digitação, verificação **`onWhatsApp`**, e **health gate por
> número** (logout/403 → `BANNED`, sai da rotação; os demais seguem). Pareamento via
> `npm run wa:link`. Não substitui a recomendação: é alternativa para quando o
> custo/burocracia da Cloud API não cabe, com o risco assumido.

---

## 2. Comparação direta

| Critério | A — Cloud API oficial | B — Não-oficial |
|---|---|---|
| Risco de cair | **Baixo** (controlável por qualidade) | **Alto** (banimento permanente) |
| "Garantia" de 1.000/dia | **Sim**, dentro do tier | Não — instável |
| Esforço de setup | Médio-alto (verificação Meta, templates) | Baixo (QR Code) |
| Esforço de código | Médio (fila, template, webhook qualidade) | Médio (gerência de sessão, reconexão) |
| Custo recorrente | Por mensagem (Meta) | Infra (servidor sessão) |
| Cold outreach frio | Permitido **com template+opt-in** | "Permitido" mas é o maior gatilho de ban |
| Legal / LGPD-friendly | Sim | Não (ToS) |
| Sustentável p/ produção | **Sim** | Não |
| Tempo até disparar | Dias (verificação) | Minutos |

**Quando B faz sentido?** Praticamente só para protótipo descartável, volume baixo, ou
quando há aceitação explícita do risco de perder o número. Para um produto que vai ser
hospedado e escalar, **não é uma base sólida**.

**Decisão recomendada: Caminho A.** O resto do documento assume A (e aponta onde B
diferiria).

---

## 3. Arquitetura de deliverability a construir

A peça que falta hoje. Vale para A; em B troca-se o transporte mas as proteções são as
mesmas (na verdade ainda mais necessárias).

```
campaign/start
     │
     ▼
[ enqueue: 1 job por lead ]──────────────►  Fila (BullMQ+Redis  ou  tabela Postgres)
                                                      │
                                          ┌───────────▼────────────┐
                                          │   Worker de disparo     │
                                          │  - rate limit + jitter  │
                                          │  - janela horário coml. │
                                          │  - cap diário           │
                                          │  - checa opt-out        │
                                          │  - checa quality gate   │
                                          └───────────┬────────────┘
                                                      │ sendMessage (template)
                                                      ▼
                                              WhatsApp Cloud API
                                                      │
                          webhook status / quality ◄──┘
                                  │
                                  ▼
                   atualiza Message.status (SENT/DELIVERED/READ/FAILED)
                   atualiza saúde do número → pausa campanha se cair
```

### Componentes

> **Status** (após a camada de deliverability):
> ✅ implementado · ⚠️ parcial · ⬜ futuro.

1. **Fila de disparo** ✅ — `campaign/start` não envia direto; enfileira 1 job por lead.
   - MVP simples: tabela `OutboundJob` no próprio Postgres + worker com polling. ✅
     (`startCampaign` enfileira; `src/server/worker/` consome com lock atômico).
   - Produção: BullMQ + Redis (retry, backoff, concorrência controlada nativos). ⬜

2. **Rate limiter + jitter** ✅ — espaçar envios. Implementado no worker: intervalo
   mínimo + **jitter aleatório** (`WHATSAPP_MIN_INTERVAL_MS`/`WHATSAPP_JITTER_MS`),
   **horário comercial** (`WHATSAPP_SEND_START_HOUR`–`END_HOUR`, fuso
   `SCHEDULING_TIMEZONE`) e **cap diário**. 1.000/dia em ~8h úteis ≈ 1 msg a cada
   ~29 s — bem confortável.

3. **Warm-up** ✅ (no modo baileys) / ⚠️ (cloud-api) — rampa para número novo. Cap
   diário global via `WHATSAPP_DAILY_CAP` (env) + `Campaign.dailyCap`. No **modo
   baileys** há cap **por chip** (`WhatsAppNumber.dailyCap`) com rotação least-loaded;
   no cloud-api (número único) o operador sobe o cap global gradualmente.

4. **Opt-in (LGPD)** ⚠️ — campo `Lead.consentSource` existe no schema, mas registrar
   a base de consentimento da origem dos leads ainda não está cabeado. Sem opt-in,
   denúncias sobem e a qualidade despenca. Requisito legal (LGPD art. 7º/8º).

5. **Opt-out automático** ✅ — no inbound, `isOptOut` detecta "PARAR / SAIR / STOP /
   CANCELAR" (palavra inteira, normalizado) → lead `DESCARTADO`/opt-out, cancela os
   jobs pendentes e **nunca mais dispara**. Defesa nº 1 contra denúncia.

6. **Quality gate / monitoramento** ✅ — `applyStatuses` atualiza `Message.status`
   (SENT/DELIVERED/READ/FAILED) e `applyQualityUpdate` **pausa campanhas RUNNING**
   quando a qualidade cai (RED/YELLOW/FLAGGED). Alerta dedicado fica como futuro.

7. **Templates** ✅ — `sendTemplate` na Cloud API + `WHATSAPP_TEMPLATE_NAME`/`_LANG`,
   com a variável `{{nome}}`. Variação de conteúdo p/ reduzir padrão de spam já existe
   no modo baileys via **spintax** (`{a|b|c}` sorteado por lead, em `src/lib/spintax.ts`).

### Impacto no schema (Prisma)

Acréscimos sugeridos (não-destrutivos):
- `Lead`: `optOut Boolean @default(false)`, `consentSource String?`.
- Novo `OutboundJob` (se fila em Postgres): `leadId`, `campaignId`, `status`
  (PENDING/SENT/FAILED), `scheduledFor DateTime`, `attempts Int`, `lastError String?`.
- Novo `WhatsAppNumber` (multi-número / warm-up): `phoneNumberId`, `displayName`,
  `dailyCap Int`, `qualityRating String`, `tier String`, `sentToday Int`.
- `Campaign`: `templateName String?` (template aprovado), `dailyCap Int?`,
  `sendWindowStart/End`.

---

## 4. Checklist de hospedagem (web + banco)

### Banco
- [ ] Migrar do Postgres em Docker local para **Postgres gerenciado** (Supabase / Neon
      / Railway). Trocar `DATABASE_URL`.
- [ ] Trocar `prisma db push` por **migrations versionadas** (`prisma migrate`) — já
      previsto como nota no PLANO.md.
- [ ] Connection pooling (PgBouncer / Supabase pooler) — serverless abre muitas conexões.

### App + worker
- [ ] **O worker de fila precisa de processo persistente.** Vercel serverless puro não
      segura worker de fila longa bem. Opções:
      - App (Next.js) na Vercel **+** worker separado em **Railway/Render/Fly**, ou
      - cron/queue gerenciado (**QStash**, Vercel Cron) chamando rota de processamento.
- [ ] **Redis** gerenciado (Upstash) se usar BullMQ.
- [ ] Webhook do WhatsApp precisa de **URL pública HTTPS estável** + verificação do
      `hub.challenge` (rota já existe) + validação de assinatura do payload.

### Segurança / config
- [ ] Segredos (`WHATSAPP_TOKEN`, `OPENAI_API_KEY`) em secret manager da plataforma,
      nunca no repo.
- [ ] Token do WhatsApp: usar **token de sistema permanente** (não o temporário de 24h
      do painel de testes).
- [ ] Rate limit / auth nas rotas de API públicas.

### Observabilidade
- [ ] Logs estruturados de cada disparo (lead, template, status, custo estimado).
- [ ] Métrica de qualidade do número + alerta quando cair.
- [ ] Painel: enviados/entregues/lidos/falhados por campanha (dados já no `Message`).

---

## 5. Pré-requisitos de negócio (Caminho A) — fora do código

Estes não são código, mas **bloqueiam o go-live** e levam dias:
1. Conta **Meta Business** + **verificação do negócio** (documentos da empresa).
2. **Número dedicado** que **não esteja** registrado no app WhatsApp comum.
3. **Display name** aprovado pela Meta.
4. **Templates** de mensagem submetidos e aprovados (cada um leva de minutos a ~1 dia).
5. Forma de pagamento configurada na WABA (cobrança por conversa).

---

## 6. Próximos passos sugeridos (ordem)

1. **Decidir caminho** (recomendado: A). ✅ este documento.
2. Iniciar **verificação Meta Business** em paralelo (é o que demora — não bloqueia o
   código).
3. Implementar a **camada de deliverability**: schema (opt-out, OutboundJob) → fila +
   worker → rate limit/jitter/janela → opt-out no webhook → quality gate.
4. Migrar **banco para gerenciado** + migrations.
5. Definir **hospedagem do worker** (Railway/Render vs QStash).
6. **Warm-up** controlado do número até 1.000/dia.

---

### Resumo de risco

| | Caminho A | Caminho B |
|---|---|---|
| Atinge 1.000/dia de forma estável? | Sim, no tier 1K | Improvável sustentar |
| "Garante" que não cai? | Sim, seguindo qualidade | **Não** |
| Pronto pra produção/hospedar? | Sim | Não |

**Conclusão:** para hospedar e operar 1.000 disparos/dia com segurança, o caminho é o
**Cloud API oficial + camada de deliverability (fila, warm-up, opt-out, quality gate)**.
A "garantia de não cair" vem de operar dentro das regras da Meta com boa qualidade —
não de um truque técnico.
