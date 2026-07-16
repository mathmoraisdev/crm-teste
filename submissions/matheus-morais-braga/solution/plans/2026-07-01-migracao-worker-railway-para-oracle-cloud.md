# Migração do worker: Railway → Oracle Cloud Free

**Data:** 2026-07-01
**Objetivo:** mover o serviço **worker** (Baileys / disparo / IA) do Railway para uma VM na Oracle Cloud "Always Free" e **desligar o Railway por completo** — o web já roda na Vercel.
**Resultado esperado:** zero re-pareamento de chips, zero perda de dados, worker rodando 24/7 sob `systemd`.

---

## 1. Por que isso é seguro (o que se move × o que fica)

O worker do Railway **não guarda estado no disco**. Todo estado durável vive em serviços externos que o Railway não controla:

| Estado | Onde mora | Perde ao matar o Railway? |
|---|---|---|
| Sessões WhatsApp (Baileys) | **Postgres** — tabela `WhatsAppAuthState` ([authstate.ts](../../src/server/whatsapp/baileys/authstate.ts)) | ❌ Não — **não re-pareia chip** |
| Leads, conversas, jobs, `WorkerHeartbeat` | Supabase Postgres | ❌ Não |
| Mídia (imagem/PDF/áudio) | Supabase Storage (bucket privado) | ❌ Não |
| App web / painel | Já na Vercel | ❌ Não |
| Cache + realtime (SSE do inbox) | Redis (**precisa ser externo** — ver §3) | ⚠️ Só se hoje for Redis interno do Railway |

O worker em modo `baileys` **não expõe porta HTTP nem recebe webhook**: é um cliente de socket (conexão de saída pro WhatsApp) e conversa com o web **só pelo banco** (polling de `processManualReplies`, `WorkerHeartbeat`, chips novos via DB). Logo a VM da Oracle precisa **só de internet de saída** — nada de domínio, porta aberta ou reverse proxy.

---

## 2. Regra de ouro do cutover: NUNCA dois workers vivos

Se o worker do Railway e o da Oracle rodarem ao mesmo tempo, **os dois abrem socket Baileys pro mesmo número** → envio duplicado e corrupção de sessão (*Bad MAC*, o ratchet Signal dessincroniza).

➡️ **Parar o worker do Railway ANTES de subir o da Oracle.** É um cutover, não um blue-green.

---

## 3. Pré-requisitos (fazer ANTES de tocar na VM)

### 3.1 Redis externo (se ainda não for)
O `REDIS_URL` é usado pelo **web (Vercel)** e opcionalmente pelo worker. Se hoje o Redis for um plugin **interno** do Railway, matar o Railway derruba o realtime do web junto.
- Provisionar **Upstash Redis (free)** → pegar a `REDIS_URL` (rediss://...).
- Setar essa mesma `REDIS_URL` **na Vercel** e **na Oracle**.
- Redis é degradável: sem ele o app funciona, só perde cache e o realtime do inbox (SSE). Não é bloqueante, mas resolva junto.

### 3.2 Inventário de env vars
Exportar TODAS as variáveis do serviço worker no Railway. Baseado em [.env.example](../../.env.example), as que o worker usa:

**Obrigatórias**
- `DATABASE_URL` (pooler Supabase, 6543, `?pgbouncer=true&connection_limit=5&pool_timeout=20`)
- `DIRECT_URL` (conexão direta Supabase, 5432)
- `OPENAI_API_KEY`
- `ENCRYPTION_KEY` (cifra credenciais BYOK — **tem que ser a MESMA da Vercel**, senão não decifra chaves salvas)
- `WHATSAPP_MODE=baileys`

**Provável/conforme uso**
- `REDIS_URL` (§3.1)
- Supabase Storage: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MEDIA_BUCKET`
- Google Calendar (se `CALENDAR_MODE=google-calendar`): `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`
- E-mail (lembretes/consultor): `RESEND_API_KEY`, `EMAIL_FROM`, `CONSULTANT_WHATSAPP`
- Tuning: `SCHEDULING_TIMEZONE`, `WORKER_POLL_MS`, `WORKER_LEASE_MS`, `WORKER_REAP_EVERY_MS`, caps de Baileys/massa, `TRIAL_*`
- Observabilidade: `SENTRY_DSN`, `NEXT_PUBLIC_*` (essas o worker ignora, mas não atrapalham)

> ⚠️ `GOOGLE_PRIVATE_KEY` tem `\n` — preservar as quebras de linha ao colar no `.env` da VM.

### 3.3 Escolha da instância Oracle (⚠️ ponto de verificação)
O Baileys 7 depende do binário nativo **`whatsapp-rust-bridge`** (patchado no [postinstall](../../scripts/patch-wa-bridge.cjs)). Antes do cutover é preciso **confirmar que ele instala e roda na arquitetura da VM**:

- **Opção A — Ampere A1 (ARM64), recomendada:** até 4 OCPU / 24 GB RAM, "Always Free". Muito mais folga. **Risco:** o `whatsapp-rust-bridge` pode não ter prebuild arm64 → `npm install` tentaria compilar (precisaria de toolchain Rust) ou falharia.
- **Opção B — VM.Standard.E2.1.Micro (x86_64), fallback:** 1 OCPU / 1 GB RAM, "Always Free". Prebuilds x86 são mais prováveis, mas 1 GB é apertado com muitos chips.

➡️ **Gate obrigatório (§5.3):** rodar `npm install` + subir o worker **manualmente** na VM escolhida e ver os chips conectarem **antes** de deletar o Railway. Se a ARM falhar no bridge, recriar na x86 micro.

---

## 4. Provisionar a VM (Oracle Cloud)

1. Console Oracle → **Compute → Instances → Create Instance**.
2. Image: **Ubuntu 22.04**. Shape: **Ampere A1** (ex.: 2 OCPU / 12 GB — dentro do free) ou **E2.1.Micro** (fallback).
3. Gerar/baixar a chave SSH.
4. **Networking:** basta a saída padrão. **Não** precisa abrir portas de entrada (worker não escuta HTTP). Deixar apenas SSH (22) na security list.
5. Criar → anotar o IP público → `ssh ubuntu@<IP>`.

---

## 5. Setup do worker na VM

Os artefatos estão versionados em [deploy/](../../deploy/) — ver [deploy/README.md](../../deploy/README.md).

### 5.1–5.2 Bootstrap (script idempotente)
[deploy/oracle-setup.sh](../../deploy/oracle-setup.sh) faz tudo: instala Node 22, clona o repo, `npm install` (roda o postinstall do patch-wa-bridge), `prisma generate` e instala o unit `systemd` (**sem iniciar**).
```bash
export REPO_URL=https://github.com/mathmoraisdev/crm-teste.git
curl -fsSL "$REPO_URL/raw/master/deploy/oracle-setup.sh" | bash
# ou, se já clonou:  bash /opt/crm/deploy/oracle-setup.sh
```

### 5.3 🔐 Gate de verificação (ANTES do cutover)
```bash
# 1) Criar o .env (ver §3.2). Colar as vars do Railway.
nano /opt/crm/.env

# 2) Boot manual do worker apontando pro banco de PROD.
#    Como não paramos o Railway ainda, use um chip de TESTE ou aceite o risco de
#    dupla-conexão por poucos segundos — o ideal é fazer este gate FORA do
#    horário comercial e com 1 chip só.
cd /opt/crm && npm run worker:prod
```
Esperado no log: `[worker] iniciado`, `[worker] calendar`, chips `CONNECTED`, heartbeat gravando. Se aparecer `ERR_PACKAGE_PATH_NOT_EXPORTED` → o patch do bridge não rodou (rever postinstall). Se falhar a instalação do `whatsapp-rust-bridge` → trocar de arquitetura (§3.3). `Ctrl+C` para parar.

### 5.4 systemd (mantém vivo + restart automático)
O unit versionado ([deploy/crm-worker.service](../../deploy/crm-worker.service)) já é instalado pelo `oracle-setup.sh` e replica o `restartPolicyType: ON_FAILURE` do Railway. Ele roda `npm run start:worker` (= `prisma db push --skip-generate --accept-data-loss && worker:prod`, o mesmo comando do Railway hoje — ver [package.json](../../package.json)).

Detalhes de desenho:
- **Env:** não usa `EnvironmentFile`. O `worker:prod` carrega `/opt/crm/.env` via `--env-file-if-exists` (parser do tsx/dotenv), que lida com aspas e multilinha (ex.: `GOOGLE_PRIVATE_KEY`) melhor que o `EnvironmentFile` do systemd. Basta o `.env` estar no `WorkingDirectory`.
- **`db push --accept-data-loss`:** mesmo comando do Railway ([railway.json](../../railway.json)); como o schema de prod já está aplicado, é no-op na prática. Ver Apêndice A para migrar pra `migrate deploy` (mais seguro) — **num segundo momento**, não junto do cutover de infra.

O `enable` (boot automático) já é feito pelo script; o `start` fica pro cutover (§6).

---

## 6. Cutover (a troca em si)

Fazer **fora do horário comercial** (janela de envio é 9–18h por padrão) pra minimizar impacto.

1. **Parar o worker do Railway** — no dashboard do Railway, remover/parar o serviço worker (`crm-teste`). Confirmar que parou (sem logs novos).
2. **Subir o worker na Oracle:**
   ```bash
   sudo systemctl start crm-worker
   sudo journalctl -u crm-worker -f
   ```
3. **Verificar (§7).**
4. Se OK por ~15–30 min → **deletar o projeto Railway inteiro** (worker + web `sparkling-harmony` + qualquer Redis/plugin interno).

---

## 7. Verificação pós-cutover

Atalho: `bash /opt/crm/deploy/verify-worker.sh` (checa serviço + heartbeat no Postgres). Checklist manual:

- [ ] `journalctl -u crm-worker -f` mostra `[worker] iniciado` e sem crash-loop.
- [ ] Chips aparecem `CONNECTED` (log do pool) — **sem pedir QR novo**.
- [ ] Heartbeat fresco: a rota de health do web (Vercel) para de acusar worker parado.
- [ ] Enviar **1 mensagem de teste** por um chip e confirmar entrega + ACK.
- [ ] Responder pelo próprio zap (operador) e ver o inbox registrar (drena via `processManualReplies`).
- [ ] Realtime do inbox (SSE) funcionando → confirma `REDIS_URL` externo ativo na Vercel.
- [ ] Um agendamento/lembrete dispara (se usar Google Calendar, confere `googleCreds: presentes` no log de boot).

---

## 8. Rollback

Enquanto o Railway **não** for deletado, o rollback é trivial:
1. `sudo systemctl stop crm-worker` na Oracle.
2. Reativar o worker no Railway.
   As sessões estão no Postgres → volta sem re-parear.

Por isso: **só deletar o Railway depois de o worker da Oracle rodar estável.**

---

## 9. Risco específico da Oracle Free (ler antes)

Contas **"Always Free"** podem ter a instância **recuperada pela Oracle** se a CPU ficar muito baixa por ~7 dias (política de idle reclaim). O loop de poll do worker (`WORKER_POLL_MS=2000`) provavelmente mantém CPU acima do limiar, mas o risco existe. Não perde dados (tudo em DB/Supabase), mas o worker pode ser **desligado**.
Mitigação: converter a conta para **Pay As You Go** (continua usando só o tier free, sem cobrança) — remove o idle reclaim. Ou monitorar o heartbeat e ter alerta.

---

## Apêndice A — (Opcional, depois) `db push` → `migrate deploy`

O repo já tem migrations versionadas em [prisma/migrations/](../../prisma/migrations/) com baseline. Trocar `db push` por `migrate deploy` é mais seguro (determinístico, sem `--accept-data-loss`). **Fazer como passo separado**, não no mesmo cutover de infra (não mexer em duas coisas ao mesmo tempo).

Passo único, uma vez, contra o banco de prod (que já tem o schema aplicado via `db push`):
```bash
# marca o baseline como já aplicado p/ o migrate deploy não tentar recriá-lo
npx prisma migrate resolve --applied 00000000000000_baseline
# se as migrations posteriores também já estiverem no banco, resolvê-las igual:
#   npx prisma migrate resolve --applied 20260629000000_message_reply_quote  ... etc
npx prisma migrate status   # deve ficar "Database schema is up to date"
```
Depois, no systemd, trocar o `ExecStart` para:
```
ExecStart=/bin/bash -lc 'npx prisma migrate deploy && npm run worker:prod'
```
> Casa com a pendência já anotada: "cutover p/ `migrate deploy` (rodar `migrate resolve --applied baseline` ANTES!)". Aproveitar pra aplicar também o índice de `Lead` e o `connection_limit` pendentes, se ainda não foram.

---

## Resumo de 1 linha
Tudo durável (sessões, dados, mídia) é externo → migrar o worker é como um redeploy. Cuidar de: **(1)** Redis externo, **(2)** copiar env (mesmo `ENCRYPTION_KEY` da Vercel), **(3)** verificar o `whatsapp-rust-bridge` na arquitetura da VM, **(4)** cutover sem dois workers vivos.
