# Fiscal NFC-e — Go-live de qualidade (Focus NFe: homologação → produção)

> **For Claude:** REQUIRED SUB-SKILL: use `executing-plans` para executar este plano tarefa a tarefa.
> **Contexto:** a **implementação** da NFC-e (Onda H, plano `2026-07-12-fiscal-nfce.md`) está **100% commitada e testada** — emissor, credencial BYOK cifrada, carimbo no fechamento, worker assíncrono, extrato com DANFE, retry e cancelamento. Este plano **NÃO reescreve nada**: é o **go-live de qualidade** — auditar o que existe, corrigir duas lacunas reais achadas na revisão, ativar em homologação contra o emissor **real** (Focus NFe), validar ponta a ponta e só então cortar para produção.

**Goal:** colocar a emissão de NFC-e em produção para o primeiro cliente pagante, com garantia de qualidade: code audit + hardening, piloto em homologação contra a Focus NFe real, cutover controlado para produção e abertura comercial na landing.

**Architecture:** inalterada — emissor terceiro (Focus NFe, único adaptador pronto) via `FiscalEmitter`/`fiscalEmitterFor`, credencial BYOK cifrada (AES-256-GCM, `ENCRYPTION_KEY`), emissão assíncrona no worker (kill-switch global `FISCAL_EMISSION` + opt-in por conta `fiscalEnabled`). Duas chaves para emitir. Sobe inerte.

**Tech Stack:** Next.js 15 (App Router) · Prisma 6 + Postgres (Supabase) · Zod · React 19 · Tailwind · Node worker (Oracle/Railway) · Vitest · Focus NFe API (NFC-e modelo 65).

**Por que este plano existe (e não "só ligar a env var"):** a revisão achou **duas lacunas concretas** que comprometem a qualidade em produção se ignoradas:
1. **Bug de UX/corretude:** `SalesHistoryPanel.tsx:368` **hardcodeia** `const FISCAL_MAX_ATTEMPTS = 5` ("espelha env"). Se o limite real mudar, a UI mostra o botão "Tentar de novo" quando o servidor vai recusar (ou o esconde quando o servidor aceitaria). O servidor é a fonte da verdade (`retryFiscalEmission` usa `env.FISCAL_MAX_ATTEMPTS`); a UI tem que ler o valor do servidor, não adivinhar.
2. **Lacuna de docs:** `.env.example` **não documenta** `FISCAL_*` (só `ENCRYPTION_KEY=`). Quem sobe o ambiente não sabe que precisa de `FISCAL_EMISSION`/`ENCRYPTION_KEY` no worker.

Fora isso, o resto é **verificação + ativação operacional**, não código.

---

## Decisões travadas (do plano anterior / conscientes)

- **Emissor = Focus NFe** (único adaptador pronto em `focus-nfe.ts`; PlugNotas/Tecnospeed são *stubs* que lançam "não suportado"). **Não** construir emissão direta pela SEFAZ ([[fisco-vs-emissor]]): a nota é fiscalmente idêntica (autorizada pela SEFAZ, CNPJ/certificado do cliente), e reinventar SOAP/XML/assinatura/certificado A1/DANFE/contingência é trabalho recorrente e indefinido (Notas Técnicas da SEFAZ) — é o core business de emissores. O custo (R$ 50–100/mês do emissor, pago pelo cliente) paga décadas de engenharia.
- **Go-live é homologação → produção, nunca direto em produção.** `fiscalEnv` default `HOMOLOGACAO`; emitir em produção por engano gera nota real com valor fiscal/contábil. O piloto roda em homologação contra o emissor real; só após validar, troca para `PRODUCAO`.
- **Duas chaves para emitir:** `FISCAL_EMISSION=true` (worker) **e** `fiscalEnabled=true` (conta). Sobe inerte (`FISCAL_EMISSION` default `false`).
- **Token nunca em claro / nunca em log.** `fiscalKeyEnc` cifrado; `fiscalKeyLast4` só p/ exibir. O worker precisa de `ENCRYPTION_KEY` p/ descriptografar — se faltar, falha cedo (por design).
- **SQL manual idempotente** (`prisma/manual/2026-07-12-onda-h.sql`) é a fonte em PROD; **nunca** duplicar com migration versionada ([[prod-schema-drift-destravar]]). Dev usa `prisma db push`.
- **Tema:** só tokens/CSS vars, nunca hex fixo ([[design-tokens-dark-theme]]). Commits pt-BR (`feat(fiscal): …`), um por tarefa.

---

## Contexto de código (o que JÁ existe — leia antes de começar)

- **Emissor:** [emitter.ts](../../src/server/fiscal/emitter.ts) (`FiscalEmitter`, `fiscalEmitterFor`, `centsToReaisString`) · [focus-nfe.ts](../../src/server/fiscal/focus-nfe.ts) (adaptador real, HTTP Basic, base por ambiente) · [mock.ts](../../src/server/fiscal/mock.ts) (determinístico, `FISCAL_MOCK`).
- **Credencial BYOK:** [fiscal-credential.service.ts](../../src/server/services/fiscal-credential.service.ts) (`getFiscalCredentialStatus`/`saveFiscalCredential`/`setFiscalProfile`/`removeFiscalCredential`) · rota [api/account/fiscal-key/route.ts](../../src/app/api/account/fiscal-key/route.ts) (GET/POST/PATCH/DELETE, gate `canFinance`).
- **Emissão assíncrona:** [fiscal-emission.ts](../../src/server/services/fiscal-emission.ts) (`nextFiscalAction`, `retryFiscalEmission`, `dispatchPendingFiscalEmissions` — flip atômico `PENDENTE→PROCESSANDO`).
- **Carimbo no fechamento:** [order.service.ts](../../src/server/services/order.service.ts) `closeOrder` (L362-385: carimba `PENDENTE` só se `fiscalEnabled`) · `voidOrder` (L488-530: cancelamento best-effort) · `reopenOrder` (L556-561: descarta carimbo só se `PENDENTE`/`ERRO`).
- **Tick no worker:** [worker/run.ts](../../src/server/worker/run.ts) L253-264 (throttle `FISCAL_EVERY_MS`, try/catch próprio, gated por `FISCAL_EMISSION`).
- **Extrato (UI):** [sales-history.service.ts](../../src/server/services/sales-history.service.ts) (devolve `fiscalStatus/Key/DanfeUrl/Error/Attempts`) · rota [api/vendas/orders/history/route.ts](../../src/app/api/vendas/orders/history/route.ts) · [SalesHistoryPanel.tsx](../../src/components/vendas/SalesHistoryPanel.tsx) `FiscalCell` (L370-439: badge por status, link DANFE, botão "Tentar de novo", retry route `api/vendas/orders/[id]/fiscal`).
- **Configurações (UI):** [AccountSettings.tsx](../../src/components/app/AccountSettings.tsx) (card "Nota fiscal (NFC-e)").
- **Env:** [env.ts](../../src/lib/env.ts) L141-148 (`FISCAL_MOCK`/`FISCAL_EMISSION`/`FISCAL_EVERY_MS`/`FISCAL_MAX_ATTEMPTS`) · L217 `isEncryptionConfigured` · [crypto.ts](../../src/server/crypto.ts) `encryptSecret`/`decryptSecret`.
- **Schema:** [prisma/schema.prisma](../../prisma/schema.prisma) (enums `FiscalProvider`/`FiscalEnv`/`FiscalStatus`; campos em `User` L254-263 e `Order` L534-541) · SQL PROD [prisma/manual/2026-07-12-onda-h.sql](../../prisma/manual/2026-07-12-onda-h.sql) (idempotente).
- **Landing:** [Landing.tsx](../../src/components/marketing/Landing.tsx) L154-168 (adicional "Nota fiscal (NFC-e)" com `available: false` → renderiza "EM BREVE").

### Convenções firmes (não desvie)
- **Multi-tenant:** credencial/perfil fiscal vivem no **dono** (`tenantUserId`); todo serviço recebe `accountId` e filtra por ele.
- **Money em centavos** (`Int`) internamente; reais decimais **só** na borda do emissor (`centsToReaisString`).
- **Segredo nunca em claro / nunca em log** — ao logar erro do emissor, **nunca** o token.
- **Idempotência do worker:** flip atômico `PENDENTE → PROCESSANDO` (`updateMany where fiscalStatus=PENDENTE`); `externalReference = order.id` deduplica no emissor.
- **Pare o `next dev` antes** de `prisma db push`/`generate` (EPERM — [[prisma-generate-dev-server-lock]]).

---

# FASE 1 — Auditoria & hardening de qualidade (código pronto, garantir que está sólido)

**Resultado:** baseline de testes verde confirmado; bug do `FISCAL_MAX_ATTEMPTS` na UI corrigido (TDD); `.env.example` documenta as variáveis fiscais; auditoria de segurança do token feita. Nada muda em produção (ainda inerte).

---

### Tarefa 1.1: Baseline — confirmar que o fiscal está verde antes de tocar em nada

**Files:** nenhum (só execução).

**Step 1 — Rode a suíte fiscal completa.**
```bash
npx vitest run src/server/fiscal src/server/services/fiscal-emission src/server/services/fiscal-credential.service src/server/services/order.service.test.ts src/app/api/vendas/orders/history/route.test.ts
```
Expected: **todos PASS**. Anote qualquer falha — se houver, **pare** e resolva antes de seguir (o go-live não pode partir de vermelho).

**Step 2 — Typecheck + lint.**
```bash
npx tsc --noEmit
npm run lint
```
Expected: **0 erros** (`tsc` limpo; `lint` sem erros novos).

**Step 3 — Anote o baseline.** Se tudo verde, siga. Se vermelho, o go-live está bloqueado — investigue com `systematic-debugging` antes de continuar. **Não commit** (não houve mudança).

---

### Tarefa 1.2: Corrigir `FISCAL_MAX_ATTEMPTS` hardcoded na UI (TDD)

**Problema:** `SalesHistoryPanel.tsx:368` tem `const FISCAL_MAX_ATTEMPTS = 5; // espelha env.FISCAL_MAX_ATTEMPTS (default)`. A UI decide mostrar/ocultar o botão "Tentar de novo" por esse número fixo, mas o servidor usa `env.FISCAL_MAX_ATTEMPTS`. Dessincronia = UX quebrada (botão some cedo demais ou aparece quando o servidor vai recusar com 400). **Fix:** o servidor devolve o limite real no envelope do histórico; a UI consome.

**Files:**
- Modify: `src/app/api/vendas/orders/history/route.ts` (devolver `fiscalMaxAttempts` no envelope)
- Test: `src/app/api/vendas/orders/history/route.test.ts` (assertar o campo)
- Modify: `src/components/vendas/SalesHistoryPanel.tsx` (ler do response; remover a constante hardcoded)

**Step 1 — Teste que falha (rota devolve `fiscalMaxAttempts`).** Em `route.test.ts`, adicione/asserta que o JSON de resposta inclui `fiscalMaxAttempts` igual ao `env.FISCAL_MAX_ATTEMPTS` do ambiente de teste:
```ts
it("devolve fiscalMaxAttempts no envelope (fonte única p/ a UI não hardcodar)", async () => {
  // ...setup autenticado + período válido (já existe helper no arquivo)...
  const res = await GET(reqAutenticado);
  const body = await res.json();
  expect(typeof body.fiscalMaxAttempts).toBe("number");
  expect(body.fiscalMaxAttempts).toBeGreaterThan(0);
});
```
> Ajuste ao helper existente no `route.test.ts` (mock de `getTenantContext`/`listSalesHistory`). Se o arquivo já mocka `sales-history.service`, mantenha o mock — só precisa do campo no envelope.

**Step 2 — Rode e veja falhar.**
```bash
npx vitest run src/app/api/vendas/orders/history/route.test.ts -t "fiscalMaxAttempts"
```
Expected: FAIL (`body.fiscalMaxAttempts` é `undefined`).

**Step 3 — Implemente na rota.** Em `history/route.ts`, no `NextResponse.json({ ...page, operators })`, adicione o limite:
```ts
import { env } from "@/lib/env";
// ...
return NextResponse.json({ ...page, operators, fiscalMaxAttempts: env.FISCAL_MAX_ATTEMPTS });
```

**Step 4 — Rode e veja passar.**
```bash
npx vitest run src/app/api/vendas/orders/history/route.test.ts
```
Expected: PASS.

**Step 5 — Consuma na UI.** Em `SalesHistoryPanel.tsx`:
- Remova a constante hardcoded (L368) `const FISCAL_MAX_ATTEMPTS = 5;`.
- No estado onde guarda o resultado do `fetch("/api/vendas/orders/history?...")` (L112), capture também `fiscalMaxAttempts` do envelope (ex.: `setFiscalMaxAttempts(data.fiscalMaxAttempts ?? 5)` — fallback 5 por segurança se o campo vier ausente).
- Passe `maxAttempts={fiscalMaxAttempts}` para `<FiscalCell>` (L268) e use no lugar da constante em L425: `{row.fiscalAttempts < maxAttempts ? (...) : (...)}`.
- Inicialize o state com `5` (default conservador) antes do primeiro fetch.

**Step 6 — Verifique (manual, dev).** `npm run dev`: abra o extrato; o badge/coluna fiscal renderiza sem erro (comanda sem nota → `—`; emita uma mock em `FISCAL_MOCK=true` para ver o `EMITIDA`+DANFE). Confirme que `FiscalCell` recebe `maxAttempts`.

**Step 7 — Rode tudo + commit.**
```bash
npx vitest run src/app/api/vendas/orders/history src/components/vendas
npx tsc --noEmit
git add src/app/api/vendas/orders/history/route.ts src/app/api/vendas/orders/history/route.test.ts src/components/vendas/SalesHistoryPanel.tsx
git commit -m "fix(fiscal): UI lê FISCAL_MAX_ATTEMPTS do servidor (não hardcode mais o limite)"
```

---

### Tarefa 1.3: Documentar variáveis `FISCAL_*` no `.env.example`

**Problema:** `.env.example` só tem `ENCRYPTION_KEY=`; não cita `FISCAL_MOCK`/`FISCAL_EMISSION`/`FISCAL_EVERY_MS`/`FISCAL_MAX_ATTEMPTS`. Quem sobe o worker não sabe que precisa de `FISCAL_EMISSION` + `ENCRYPTION_KEY` para emitir.

**Files:**
- Modify: `.env.example` (bloco fiscal após `ENCRYPTION_KEY=`)

**Step 1 — Adicione o bloco.** Logo após o bloco `ENCRYPTION_KEY=` (e a nota sobre BYOK de IA), insira:
```bash
# ─────────────────────────────────────────────────────────────
# Fiscal — NFC-e via emissor terceiro (Focus NFe). Onda H.
# ─────────────────────────────────────────────────────────────
# Kill-switch GLOBAL de emissão: false = nada é emitido (sobe inerte).
# Precisa estar true no WORKER p/ emitir. A 2ª chave é o opt-in por conta
# (User.fiscalEnabled, ligado na UI). As duas precisam estar ligadas.
FISCAL_EMISSION="false"
# Dev/teste: emissor determinístico sem tocar SEFAZ. SEMPRE false em produção.
FISCAL_MOCK="false"
# Throttle do tick fiscal no worker (ms). SEFAZ é lento; default 60s.
FISCAL_EVERY_MS="60000"
# Teto de tentativas (retry manual no extrato). Acima disso o botão some.
FISCAL_MAX_ATTEMPTS="5"
# ATENÇÃO: o WORKER precisa de ENCRYPTION_KEY (acima) para descriptografar o
# token do emissor na emissão. Sem ela, saveFiscalCredential/emissão falham cedo.
```

**Step 2 — Verifique consistência.** Confira que os defaults batem com [env.ts](../../src/lib/env.ts) L141-148 (`FISCAL_MOCK=false`, `FISCAL_EMISSION=false`, `FISCAL_EVERY_MS=60000`, `FISCAL_MAX_ATTEMPTS=5`).

**Step 3 — Commit.**
```bash
git add .env.example
git commit -m "docs(fiscal): documenta variáveis FISCAL_* no .env.example"
```

---

### Tarefa 1.4: Auditoria de segurança — token nunca logado/devolvido

**Files:** nenhum (revisão dirigida; só commit se achar fuga).

**Step 1 — Busque fugas de token.**
```bash
grep -rn "fiscalKeyEnc\|apiKey\|fiscalKey" src/server/fiscal src/server/services/fiscal-emission.ts src/server/services/fiscal-credential.service.ts src/server/services/order.service.ts
```
Verifique: (a) nenhum `logger.*` inclui o token/apiKey; (b) nenhum `NextResponse.json` devolve `fiscalKeyEnc` (só `last4`); (c) `decryptSecret` só é chamado no worker, nunca exposto.

**Step 2 — Confirme o DTO.** `getFiscalCredentialStatus` (fiscal-credential.service.ts L23-48) devolve `configured/provider/last4/verifiedAt/enabled/env/serie/cnpj/defaultNcm/defaultCfop` — **nunca** `fiscalKeyEnc`. ✓

**Step 3 — Confirme o log de erro.** Em `fiscal-emission.ts` `dispatchPendingFiscalEmissions`, o `logger.error({ orderId: o.id, err }, ...)` loga `orderId`+`err`, **não** o `apiKey`. ✓ Se o `err` de um `fetch` pudesse incluir o header `Authorization`, sanitize (não deve — `fetch` errors não vaziam headers; só confirme).

**Step 4 — Achou fuga?** Corrija + teste + commit (`fix(fiscal): não vazar token do emissor em log/response`). Não achou? Anote "auditoria OK" e siga — sem commit.

---

# FASE 2 — Ativação em homologação (piloto contra o emissor REAL)

**Resultado:** uma conta piloto emite NFC-e **real na Focus NFe em homologação** (notas de teste, sem valor fiscal), validando o fluxo ponta a ponta: fechamento → `PENDENTE` → worker → `EMITIDA` → DANFE → retry → cancelamento no estorno. **Nenhuma nota de produção ainda.**

> **Pré-requisito de produto:** o cliente (ou você, em nome dele) cria a conta na **Focus NFe** (homologação), cadastra o CNPJ, o **certificado A1** e o **CSC** lá, e gera o **token da API**. Sem isso, não há piloto. Esse passo é **no portal da Focus NFe**, não no nosso código.

---

### Tarefa 2.1: Garantir o schema fiscal no Supabase (PROD)

**Files:** `prisma/manual/2026-07-12-onda-h.sql` (já existe; só aplicar/verificar).

**Step 1 — Verifique se já está aplicado.** No Supabase SQL Editor:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'User' AND column_name IN ('fiscalProvider','fiscalKeyEnc','fiscalEnabled');
```
Se retornar as 3 colunas, o schema fiscal já está em prod — pule para a 2.2. Se vazio, aplique (Step 2).

**Step 2 — Aplique o SQL idempotente.** Cole o conteúdo **inteiro** de `prisma/manual/2026-07-12-onda-h.sql` no Supabase SQL Editor e execute. É idempotente (enums guardados por `EXCEPTION`, colunas `ADD COLUMN IF NOT EXISTS`, índice `IF NOT EXISTS`) — re-aplicar é seguro.

**Step 3 — Valide.** Re-rode a query do Step 1 + a versão para `Order`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'Order' AND column_name IN ('fiscalStatus','fiscalDanfeUrl','fiscalAttempts');
```
Expected: as colunas existem. **Não há rollback** — são colunas novas nullable/default, não quebram nada existente.

---

### Tarefa 2.2: Configurar variáveis de ambiente (Railway worker + Vercel web)

**Files:** nenhum (configuração nos portais).

> **Por que nos dois:** o **web** (Vercel) cifra o token ao salvar (`saveFiscalCredential` usa `ENCRYPTION_KEY`); o **worker** (Railway) descriptografa ao emitir (`dispatchPendingFiscalEmissions` usa `ENCRYPTION_KEY` + `FISCAL_EMISSION`). As duas precisam da mesma `ENCRYPTION_KEY`.

**Step 1 — Vercel (web).** No painel do projeto → Settings → Environment Variables:
- `ENCRYPTION_KEY` = **mesmo valor de 64 hex já usado pelo worker** (CRÍTICO: se forem diferentes, o worker não descriptografa o token que o web cifrou). Se ainda não existe no web, crie com o mesmo valor.
- `FISCAL_MOCK` = `false` (produção nunca usa mock).

**Step 2 — Railway (worker).** No serviço do worker → Variables:
- `FISCAL_EMISSION` = `true` (liga o kill-switch global — é o que permite emitir).
- `ENCRYPTION_KEY` = **idêntico ao do Vercel**.
- `FISCAL_MOCK` = `false`.
- `FISCAL_EVERY_MS` = `60000` (default; não mexa).
- `FISCAL_MAX_ATTEMPTS` = `5` (default).

**Step 3 — Reinicie o worker** para pegar as vars (Railway redeploy). Confirme no log de startup que não há erro de `ENCRYPTION_KEY`.

**Step 4 — Sanidade (ainda inerte).** Mesmo com `FISCAL_EMISSION=true`, **nenhuma conta** emite ainda: nenhuma tem `fiscalEnabled=true` + credencial. O sistema está armado, não disparado. ✓

---

### Tarefa 2.3: Conta Focus NFe em homologação (no portal, não no código)

**Files:** nenhum (portal Focus NFe).

**Step 1 — Crie a conta** em `homologacao.focusnfe.com.br` (NÃO `api.focusnfe.com.br`, que é produção).

**Step 2 — Cadastre o emitente:** CNPJ do cliente, **certificado digital A1** (upload do PFX + senha) e o **CSC** (Código de Segurança do Contribuinte, obtido na SEFAZ do estado do cliente). Sem CSC, NFC-e é rejeitada.

**Step 3 — Gere o token da API** (menu de integração/tokens). Guarde — é o que vai no `apiKey` do nosso sistema.

**Step 4 — Defina a série** (geralmente `1`) e um **NCM/CFOP padrão** razoável para o ramo do cliente (ex.: varejo genérico NCM `99999999` só é aceito em homologação; em produção precisa NCM real. Para o piloto em homologação, qualquer NCM aceito pela SEFAZ de homologação serve — o objetivo é validar o **fluxo**, não a classificação fiscal).

---

### Tarefa 2.4: Cadastrar o token + ligar o opt-in na conta piloto (UI)

**Files:** nenhum (UI do app).

**Step 1 — Entre como dono** da conta piloto (a que vai emitir). Abra **Configurações → Nota fiscal (NFC-e)**.

**Step 2 — Salve a credencial:** provedor `FOCUS_NFE`, cole o **token de homologação**, ambiente `HOMOLOGACAO`. Clique salvar.
Expected: valida contra a Focus NFe (`verifyCredential` → GET `/v2/empresas` com o token) e mostra `•••• <last4>`. Se falhar ("Não consegui validar o token..."), confira o token e o ambiente.

**Step 3 — Preencha o perfil fiscal:** série `1`, CNPJ do cliente, NCM padrão, CFOP padrão (ex.: `5102` venda no estado — ajuste ao estado/ramo).

**Step 4 — Ligue o opt-in:** switch "Emitir NFC-e no fechamento" (`fiscalEnabled`). Expected: liga (exige credencial já salva — sem ela, erro). A conta está pronta para emitir.

---

### Tarefa 2.5: Piloto E2E em homologação — fechar comanda → nota emitida

**Files:** nenhum (validação ponta a ponta).

**Step 1 — Crie uma comanda** com 1–2 itens de preço válido (ex.: R$ 10,00). Feche a comanda (pagamento qualquer).

**Step 2 — Verifique o carimbo.** No banco (Supabase) ou no extrato: a comanda nasce `fiscalStatus = PENDENTE` (conta opt-in). Sem opt-in seria `null`.
```sql
SELECT id, number, "fiscalStatus", "fiscalRequestedAt", "fiscalError"
FROM "Order" ORDER BY "closedAt" DESC LIMIT 5;
```

**Step 3 — Aguarde o tick** (`FISCAL_EVERY_MS`, ~1 min). O worker: flip `PENDENTE→PROCESSANDO` → `emitNfce` (POST `/v2/nfce?ref=<orderId>`) → resolve.

**Step 4 — Confirme `EMITIDA`.** Re-rode a query do Step 2: `fiscalStatus = EMITIDA`, `fiscalKey` (44 dígitos), `fiscalDanfeUrl` preenchida, `fiscalIssuedAt` setada. No **extrato de vendas**, o badge fica verde com o botão **DANFE**.

**Step 5 — Abra o DANFE.** Clique no link DANFE → abre o PDF no emissor (homologação). Confira: CNPJ do cliente, itens, total, chave de acesso, QR code. ✓

**Step 6 — Se ficou `ERRO`:** leia `fiscalError` (mensagem da SEFAZ de homologação — ex.: NCM inválido, CSC ausente). Corrija no perfil fiscal ou no portal Focus NFe, clique **"Tentar de novo"** no extrato (volta a `PENDENTE`). O worker re-emite.

> **Critério de aprovação da Fase 2 (homologação):** pelo menos **uma** comanda `EMITIDA` com DANFE válido na Focus NFe de homologação. Sem isso, **não** ir para produção.

---

### Tarefa 2.6: Validar retry e cancelamento no estorno (homologação)

**Files:** nenhum (validação).

**Step 1 — Retry em ERRO.** Force um erro (ex.: NCM inválido temporariamente) → comanda vai `ERRO` com motivo → corrija → botão "Tentar de novo" → volta `PENDENTE` → worker re-emite → `EMITIDA`. Confirme também o limite: após `FISCAL_MAX_ATTEMPTS` retentativas, o botão some ("limite atingido").

**Step 2 — Cancelamento no estorno.** Estorne (void) uma comanda com `fiscalStatus = EMITIDA`:
Expected: o `voidOrder` chama `cancelNfce` (best-effort, fora da tx) → se a janela legal permitir, `fiscalStatus = CANCELADA`; se a janela passou, permanece `EMITIDA` com `fiscalError` de aviso (sem derrubar o estorno). No extrato: badge "cancelada" (riscado) ou "erro" com aviso.

**Step 3 — Reabertura.** Reabra uma comanda ainda `PENDENTE`/`ERRO` → campos fiscais zerados (`fiscalStatus = null`). Reabrir uma `EMITIDA` **não** descarta a nota (trava — a via é estorno/cancelamento).

---

# FASE 3 — Cutover para produção

**Resultado:** o cliente emite **nota fiscal real** (com valor fiscal/contábil), autorizada pela SEFAZ, no ambiente de produção da Focus NFe. Só após a Fase 2 aprovada.

---

### Tarefa 3.1: Trocar para `PRODUCAO` (token + `fiscalEnv`)

**Files:** nenhum (UI + portal).

**Step 1 — Conta Focus NFe em produção.** No portal `api.focusnfe.com.br` (PRODUÇÃO, não homologação): certifique-se de que o **certificado A1 e CSC de produção** estão cadastrados (são diferentes da homologação). Gere o **token de produção**.

**Step 2 — Re-salve a credencial** na UI: provedor `FOCUS_NFE`, **token de produção**, ambiente **`PRODUCAO`** (o toggle de ambiente tem aviso — "Produção emite nota real"). Isso sobrescreve o token de homologação.

**Step 3 — NCM/CFOP reais.** Definitivo: o **NCM padrão** precisa ser válido para o ramo (a SEFAZ de produção rejeita NCM `99999999`). Se o catálogo for heterogêneo, documente a limitação v1 (NCM padrão da conta; per-item é onda futura — ver Riscos). CFOP conforme estado (ex.: `5102` operação dentro do estado, `6102` fora).

> **Atenção:** `fiscalEnv` default é `HOMOLOGACAO` por segurança. Conferir **duas vezes** que está `PRODUCAO` antes de fechar a primeira comanda real.

---

### Tarefa 3.2: Primeira nota real (baixo valor)

**Files:** nenhum.

**Step 1 — Feche uma comanda real de baixo valor** (ex.: R$ 1,00 — uma venda de verdade do cliente, não um item de teste). A conta está com `fiscalEnabled=true` + `fiscalEnv=PRODUCAO`.

**Step 2 — Acompanhe o fluxo** (igual ao 2.5, mas em produção): `PENDENTE` → `PROCESSANDO` → `EMITIDA` com `fiscalKey` de 44 dígitos.

**Step 3 — Se `ERRO`:** leia `fiscalError` (SEFAZ de produção é mais rigorosa que homologação). Comum na primeira: NCM/CFOP incorreto, CSC não cadastrado em produção, certificado vencido. Corrija no perfil/portal e "Tentar de novo".

---

### Tarefa 3.3: Validar a nota no portal do contribuinte da SEFAZ

**Files:** nenhum.

**Step 1 — Valide a chave de acesso.** Pegue os 44 dígitos do `fiscalKey` e consulte no portal da SEFAZ do estado do cliente (ou no portal nacional NFC-e). A nota deve constar como **Autorizada**, com o CNPJ do cliente como emitente.

**Step 2 — Confirme o DANFE.** Abra `fiscalDanfeUrl` → PDF com QR code escaneável. Escaneie o QR code com o celular → deve levar à consulta da SEFAZ mostrando a nota.

**Step 3 — Critério de aprovação da Fase 3:** nota real **Autorizada** na SEFAZ, visível no portal do contribuinte, DANFE válido. A partir daqui o cliente pode emitir normalmente.

---

# FASE 4 — Abertura comercial

**Resultado:** o adicional "Nota fiscal (NFC-e)" aparece como **disponível** na landing (não mais "EM BREVE"), e há um runbook para ativar novos clientes.

---

### Tarefa 4.1: Virar a landing para disponível

**Files:**
- Modify: `src/components/marketing/Landing.tsx:163-167`

**Step 1 — Edite o addon.** Mude `available: false` → `available: true` e dê um preço (decida o preço do adicional; se ainda não definiu comercialmente, use o mesmo padrão do delivery — defina uma constante em `plans.ts` antes):
```ts
{
  name: "Nota fiscal (NFC-e)",
  icon: Receipt,
  desc: "Emita o cupom fiscal automaticamente no fechamento da comanda, com a chave do seu emissor.",
  priceMonthly: NFC_E_ADDON_PRICE_CENTS / 100, // definir em plans.ts
  available: true,
},
```
> Se preferir não cobrar à parte ainda (incluso no plano do cliente), mantenha `available: true` sem preço — mas o card hoje exige `priceMonthly` quando `available`. Decida e trave. Recomendado: definir `NFC_E_ADDON_PRICE_CENTS` em `plans.ts` (fonte única, igual `DELIVERY_ADDON_PRICE_CENTS`).

**Step 2 — Verifique (dev).** `npm run dev`: na landing, o card mostra o preço e o botão "Falar com o suporte" (em vez de "EM BREVE").

**Step 3 — Commit.**
```bash
git add src/components/marketing/Landing.tsx src/lib/plans.ts
git commit -m "feat(fiscal): landing abre adicional Nota fiscal (NFC-e) para oferta"
```

---

### Tarefa 4.2: Runbook de ativação para novos clientes

**Files:**
- Create: `docs/runbooks/2026-07-30-fiscal-nfce-ativacao.md`

**Step 1 — Escreva o runbook** (passo a passo, baseado nas Fases 2–3, mas enxuto para um operador/internal usar por cliente): (1) schema já aplicado (one-time, confirmar); (2) cliente cria conta Focus NFe + certificado A1 + CSC + token; (3) cadastrar token na UI (homologação primeiro); (4) ligar `fiscalEnabled`; (5) piloto 1 comanda em homologação; (6) trocar para produção; (7) primeira nota real + validar SEFAZ. Inclua o checklist de "duas chaves" e os erros comuns (NCM/CSC/certificado).

**Step 2 — Commit.**
```bash
git add docs/runbooks/2026-07-30-fiscal-nfce-ativacao.md
git commit -m "docs(fiscal): runbook de ativação da NFC-e por cliente (homologação→produção)"
```

---

## Verificação de ponta a ponta (antes de fechar)

1. `npm test` inteiro verde + `npx tsc --noEmit` limpo + `npm run lint` sem erros novos.
2. **Hardening (Fase 1):** `FISCAL_MAX_ATTEMPTS` vem do servidor na UI (botão "Tentar de novo" respeita o limite real); `.env.example` documenta `FISCAL_*`; auditoria de token sem fuga.
3. **Homologação (Fase 2):** comanda fechada → `EMITIDA` com DANFE na Focus NFe de homologação; retry funciona; estorno cancela (best-effort); reabertura respeita `EMITIDA`.
4. **Produção (Fase 3):** nota real Autorizada na SEFAZ, visível no portal do contribuinte, DANFE com QR code válido.
5. **Segurança:** nenhum log/response vaza o token; `fiscalKeyEnc` cifrado; `ENCRYPTION_KEY` idêntico entre web e worker.
6. **Comercial (Fase 4):** landing mostra o adicional disponível; runbook existe.

---

## Riscos e notas

- **NCM/CFOP por item é a limitação real do v1.** Usa padrão da conta — funciona p/ varejo simples, **erra** em catálogos heterogêneos. A SEFAZ **rejeita** (status `ERRO` com o motivo) — não emite nota errada silenciosamente. Per-item (`CatalogItem.ncm/cfop`) é onda futura (o `EmitNfceInput.items` já aceita). **Comunique isso ao cliente** antes de ele esperar classificação automática por produto.
- **Homologação × produção é crítico.** `fiscalEnv` nunca default produção; a UI avisa. Emitir em produção por engano gera nota real — por isso o piloto começa em homologação e o cutover é explícito (Tarefa 3.1).
- **`ENCRYPTION_KEY` deve ser idêntica** entre Vercel (web) e Railway (worker). Se diferirem, o worker não descriptografa o token que o web cifrou → `ERRO` em toda emissão. Confira antes do piloto.
- **CSC e certificado A1 moram na Focus NFe**, não aqui. Se expirarem, a SEFAZ rejeita — o cliente precisa renovar no portal do emissor. Documente no runbook.
- **SEFAZ é lenta/instável** — por isso a emissão é assíncrona no worker (nunca no fechamento) e resiliente: `PENDENTE`→`PROCESSANDO`→re-consulta; rede falha volta a `PENDENTE`; `ERRO` sai da fila (retry manual, p/ não martelar com nota malformada). O caixa nunca trava.
- **Nota em doblo** — guardada por (a) flip atômico `updateMany where fiscalStatus=PENDENTE` e (b) `externalReference=order.id` (o emissor deduplica pela ref). As duas camadas cobrem corrida entre ticks/instâncias.
- **Cancelamento tem janela legal curta (~30 min NFC-e).** O estorno pode vir depois — v1 faz best-effort e, se a janela passou, deixa `EMITIDA` com aviso (o contador resolve por carta de correção/devolução).
- **Foco no Focus NFe.** PlugNotas/Tecnospeed são *stubs* que lançam "não suportado". Se um cliente futuro exigir outro emissor, escreva um adaptador novo seguindo o molde de `focus-nfe.ts` (TDD com `fetch` mockado) — **não** tente emissão direta pela SEFAZ ([[fisco-vs-emissor]]).

---

## Ordem de entrega recomendada

1. **Fase 1 (hardening)** — TDD do fix + docs + auditoria. Ship isolado, zero impacto em prod (ainda inerte). **Faça primeiro.**
2. **Fase 2 (homologação)** — exige conta Focus NFe do cliente. Critério de aprovação: 1 comanda `EMITIDA` com DANFE em homologação.
3. **Fase 3 (produção)** — só após Fase 2. Critério: nota real Autorizada na SEFAZ.
4. **Fase 4 (comercial)** — só após o cliente estar emitindo em produção. Abre a oferta + runbook.
