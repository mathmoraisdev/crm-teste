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

1. **Fila de disparo** — `campaign/start` não envia direto; enfileira 1 job por lead.
   - MVP simples: tabela `OutboundJob` no próprio Postgres + worker com polling.
   - Produção: BullMQ + Redis (retry, backoff, concorrência controlada nativos).

2. **Rate limiter + jitter** — espaçar envios. Sugestão inicial: 1 msg a cada **5–10 s
   com jitter aleatório**, respeitando **horário comercial** (ex.: 9h–18h, dias úteis,
   fuso do lead) e **cap diário** configurável por número. 1.000/dia em ~8h úteis ≈
   1 msg a cada ~29 s — bem confortável.

3. **Warm-up** — rampa para número novo. Ex.: semana 1 ~20–50/dia, dobrando a cada
   poucos dias até o alvo, sempre observando a qualidade. Campo `dailyCap` por número
   que o operador sobe gradualmente.

4. **Opt-in (LGPD)** — registrar a base de consentimento da origem dos leads. Sem
   opt-in, denúncias sobem e a qualidade despenca. É também requisito legal
   (LGPD art. 7º/8º).

5. **Opt-out automático** — no inbound, detectar "PARAR / SAIR / STOP / CANCELAR" →
   marcar lead como `DESCARTADO`/opt-out e **nunca mais disparar**. É a defesa nº 1
   contra denúncia (denúncia é o que mais derruba número).

6. **Quality gate / monitoramento** — consumir o webhook de **quality rating** e os
   **status de mensagem** (o schema já tem `MessageStatus`). Se qualidade cair p/
   amarelo/vermelho ou a taxa de `FAILED` subir, **pausar a campanha automaticamente**
   e alertar.

7. **Templates** — gestão dos templates aprovados (Marketing/Utility), com variáveis
   (`{{nome}}` já existe). Idealmente 2–3 variações para reduzir padrão de spam.

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
- [ ] Segredos (`WHATSAPP_TOKEN`, `ANTHROPIC_API_KEY`) em secret manager da plataforma,
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
