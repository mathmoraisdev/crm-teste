# Admin da plataforma em conta própria — Runbook de migração

> **Natureza:** isto é um **runbook operacional** (env + dados + verificação), **não** um plano de código
> TDD — não há código a escrever. Executa-se à mão, com cuidado de ordem. Documento-pai:
> `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 15 — sem onda de schema).

**Goal:** separar o "god-mode" do SaaS numa **conta/login própria e limpa** (sem negócio), e **rebaixar
a conta atual** (que tem o número do cartório conectado) para uma **conta de cliente normal** — sem
reconectar o WhatsApp e sem derrubar o atendimento do cartório.

**Como o admin é decidido (base de tudo):** `isAdminEmail(email)` = o e-mail está na env
**`ADMIN_EMAILS`** (lista por vírgula — `src/lib/admin.ts`). Ser admin concede: rotas `/financeiro`
(Administração) e `/consultores`; **IA ilimitada** e **sem teto** de números/leads (`entitlements.ts`,
`numbers.service.ts`, `lead.service.ts`); e **imunidade a suspensão** (`account.service.ts:254`). Uma
conta **sem plano** (`plan = null`) é "grandfather" → **também sem tetos**. O acesso vale enquanto
`accessUntil` está no futuro **ou** `billingOverride = ACTIVE`.

**Princípios de segurança da migração:**
- **Nunca ficar sem admin:** adicionar o admin novo e **verificar** ANTES de remover o antigo.
- **Nunca derrubar o cartório:** blindar a conta com `billingOverride = ACTIVE` ANTES de rebaixar.
- **Senha é só sua:** a conta nova é criada por você no `/signup`; nenhuma credencial passa por mim.
- **Env vive em 2 lugares:** Vercel (web) **e** worker no Oracle (`.env`). `ADMIN_EMAILS` tem de ser
  **igual** nos dois, senão web e worker divergem. Env só vale após **redeploy** (web) / **restart** (worker).

---

## Estado atual a levantar (Fase 0 — pré-voo)

1. **Qual é o e-mail admin de hoje** (o do cartório) e o valor atual de `ADMIN_EMAILS`:
   - Vercel → Project → Settings → Environment Variables → `ADMIN_EMAILS`.
   - Oracle (worker): `ssh -i ~/.ssh/oracle-crm ubuntu@136.248.93.142` → conferir `ADMIN_EMAILS` no `.env`
     do worker ([[worker-oracle-update-procedure]]).
2. **Estado da conta do cartório** (Supabase SQL Editor — env do DB é Sensitive):
   ```sql
   SELECT email, plan, "accessUntil", "billingOverride" FROM "User"
   WHERE lower(email) = lower('SEU_EMAIL_ATUAL_DO_CARTORIO');
   ```
   Anote `plan`, `accessUntil`, `billingOverride` — é o que vamos preservar.

---

## Fase 1 — Criar a conta admin nova (sem derrubar nada)

**Você faz (credencial só sua):**
1. Escolha um **e-mail novo** (ex.: `admin@suaempresa.com`) e uma **senha** — só você conhece.
2. Cadastre pelo **`/signup`** e **confirme o e-mail** (o app exige `emailVerified`).

**Config (adiciona o novo, MANTÉM o antigo — dois admins temporariamente):**
3. Em `ADMIN_EMAILS`, deixe **os dois** e-mails:
   `cartorio@...,admin@suaempresa.com`
   - Atualize na **Vercel** (env) → **redeploy** (`env -u CLAUDECODE CI=1 npx vercel deploy --prod`
     [[vercel-hobby-push-block]]).
   - Atualize no **worker Oracle** (`.env`) → `systemctl restart crm-worker`.

**Verificar:**
4. Faça login na **conta nova** → o menu mostra **Administração** e **Consultores**; a lista de contas
   carrega (você já enxerga o cartório lá dentro). ✅ Agora há dois admins — nada quebrou.

---

## Fase 2 — Blindar a conta do cartório (antes de tirar o god-mode)

Sem o "admin", a conta passa a depender de `accessUntil`/`billingOverride`. Blinde-a para não suspender:

1. **Manter `plan = null`** (grandfather → sem teto de IA/números/leads). É a sua própria operação; não
   faz sentido se auto-cobrar. *(Alternativa: atribuir um plano se você quiser cotas — não recomendado aqui.)*
2. **Forçar acesso permanente** — pela **conta admin nova** (menu Administração → a conta do cartório →
   `AccountAccessModal` → **ACTIVE**), **ou** direto no Supabase:
   ```sql
   UPDATE "User" SET "billingOverride" = 'ACTIVE'
   WHERE lower(email) = lower('SEU_EMAIL_ATUAL_DO_CARTORIO');
   ```
3. Confirmar:
   ```sql
   SELECT email, plan, "billingOverride" FROM "User"
   WHERE lower(email) = lower('SEU_EMAIL_ATUAL_DO_CARTORIO');
   -- billingOverride deve ser ACTIVE
   ```

---

## Fase 3 — Rebaixar o e-mail do cartório

1. Em `ADMIN_EMAILS`, **remova o e-mail do cartório** — fica só `admin@suaempresa.com`.
   - Atualize **Vercel** → redeploy. Atualize **worker Oracle** (`.env`) → restart. (Os dois!)
2. **Verificar na conta do cartório** (login do cartório):
   - O número segue **conectado**, envia/recebe e a **IA responde** — sem reconectar. ✅
   - **Sumiram** os itens **Administração** e **Consultores** do menu.
   - A conta **não** foi suspensa (por causa do `billingOverride = ACTIVE`).
3. **Verificar na conta admin nova:**
   - Administra tudo (contas, receita, avisos, consultores); vê o cartório na lista como conta comum.

---

## Rollback (se algo sair errado)

Re-adicione o e-mail do cartório ao `ADMIN_EMAILS` (Vercel + worker) e redeploy/restart → ele volta a ser
admin na hora. Como `isAdminEmail` é avaliado **a cada request** a partir do env, não há estado preso: é
reversível só mexendo na env.

---

## Riscos e notas

- **Ordem é sagrada:** Fase 1 (novo admin OK) → Fase 2 (blindar cartório) → Fase 3 (remover antigo).
  Nunca remova o antigo antes de o novo funcionar, nem antes do `billingOverride = ACTIVE`.
- **Dois lugares de env:** `ADMIN_EMAILS` na Vercel **e** no worker Oracle. Divergência → web e worker
  tratam a mesma conta de formas diferentes (ex.: cota de IA). Mantenha idêntico.
- **Redeploy/restart obrigatórios:** env nova só vale após deploy (web) e restart (worker).
- **Nada de schema, nada de reconexão:** o número (`WhatsAppNumber`), leads e conversas são do `userId`
  da conta do cartório — rebaixar não os toca. Zero pareamento novo.
- **Segurança do login novo:** senha forte, só sua, não reusada. Este login vira o god-mode do SaaS —
  trate como credencial crítica (idealmente com 2FA no e-mail). Não a compartilhe em lugar nenhum.
- **Consultant leads:** o roteamento de leads da landing usa a lista de admins; com o admin novo ativo,
  segue funcionando (`consultant.service.ts`).
- **Este é o primeiro passo da separação;** a Fase 4 do plano de navegação (painel `/admin/*` dedicado +
  switch de contexto) complementa isto no lado da UI, mas **não é pré-requisito** — a separação de
  credencial já funciona sozinha por env.
```
