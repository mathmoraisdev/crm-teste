# Fiscal NFC-e — emissão via emissor terceiro (opt-in por conta, BYOK cifrado)

> **For Claude:** REQUIRED SUB-SKILL: use `executing-plans` para implementar este plano tarefa a tarefa.
> **Mestre:** iniciativa 13 de `2026-07-05-roadmap-multinegocio.md` (Release 5, **Onda H**). Este plano é filho do mestre.

**Goal:** dar ao balcão a **última peça de formalização** — emitir **NFC-e** (nota fiscal de consumidor
eletrônica) no fechamento da comanda — **sem construir a SEFAZ do zero**. A emissão delega a um **emissor
terceiro por API** (Focus NFe / PlugNotas / Tecnospeed), configurado **por conta** com credencial **BYOK
cifrada** (mesmo padrão do BYOK de IA e de pagamento). É **opt-in por conta** (`fiscalEnabled`, default
`false`): nada muda para os ~60 modelos que não emitem nota. A emissão é **assíncrona no worker** (SEFAZ é
lento/instável — não pode travar o fechamento), com status fiscal por comanda e **reimpressão do DANFE** no
extrato.

**Architecture:** três camadas, espelhando o que já existe:
1. **Credencial BYOK cifrada** (`User.fiscalKeyEnc` via `encryptSecret`/`decryptSecret`, [[strong-model-byok-only]])
   + **perfil fiscal mínimo** da conta (ambiente homologação/produção, série, CNPJ de referência, NCM/CFOP
   padrão). O **cadastro tributário pesado** (regime, CSC/token NFC-e, certificado A1) mora **no emissor
   terceiro** — nós só guardamos o **token da API** dele + o mínimo de roteamento. Espelha
   `payment-credential.service` + `PaymentGateway`/`gatewayFor`.
2. **Abstração de emissor** (`FiscalEmitter` + `fiscalEmitterFor(provider)`) — uma interface (`verifyCredential`,
   `emitNfce`, `getStatus`, `cancelNfce`) com um adaptador **real** (Focus NFe) e um **mock** (dev/teste). O
   domínio nunca fala HTTP direto — igual `PaymentGateway`.
3. **Emissão assíncrona no worker** — o fechamento **carimba** `fiscalStatus=PENDENTE` (só se a conta é
   opt-in), no mesmo laço onde já grava snapshot de custo/comissão; um **tick no worker**
   (`dispatchPendingFiscalEmissions`) drena os pendentes, chama o emissor, resolve para `EMITIDA`/`ERRO` e
   re-consulta os `PROCESSANDO`. Gated por **duas chaves**: kill-switch global `FISCAL_EMISSION` **e** opt-in
   por conta `fiscalEnabled` — exatamente o padrão da automação de ciclo de vida ([[automacao-ciclo-vida-feito]]).

**Tech Stack:** Next.js 15 (App Router, route handlers) · Prisma 6 + Postgres (Supabase) · Zod · React 19 ·
Tailwind (tokens de tema) · Node worker (Oracle) · AES-256-GCM (`crypto.ts`) · Vitest.

**Escopo (o que NÃO entra em v1):**
- **Classificação tributária por item** (NCM/CFOP/CST/CSOSN por produto) — v1 usa um **NCM/CFOP padrão da
  conta** (ou a "regra fiscal padrão" configurada no emissor para Simples Nacional). `CatalogItem.ncm/cfop`
  por item é **onda futura** (mesmo espírito do `ItemVariant` adiado na Onda G). Documentado nos Riscos.
- **NF-e (modelo 55) / NFS-e (serviço municipal)** — v1 é **só NFC-e (modelo 65)**, o cupom fiscal de venda
  presencial ao consumidor. NFS-e (serviços) e NF-e (B2B) são follow-ups.
- **Contingência offline (SEFAZ fora do ar)** — v1 deixa a comanda em `ERRO`/`PENDENTE` e re-tenta pelo
  worker; contingência formal (SCAN/EPEC) fica com o emissor terceiro.
- **Cancelamento robusto de NFC-e** — a janela legal de cancelamento é curta (~30 min) e o estorno de comanda
  pode vir depois. v1 faz **best-effort**: ao estornar uma comanda com nota `EMITIDA`, marca para
  cancelamento e o worker tenta `cancelNfce`; se a janela passou, a nota fica `EMITIDA` com aviso (o
  contador resolve por carta de correção/denúncia de espontaneidade). Documentado nos Riscos.

**Decisões de produto:**
- **Opt-in por conta** (`fiscalEnabled`, default `false`) — sem opt-in, nenhuma comanda vira nota. Ligar exige
  credencial do emissor validada. Nada polui os modelos de serviço/atendimento puro.
- **Emissão assíncrona, nunca no fechamento** — SEFAZ leva de segundos a minutos e cai; o caixa **não pode**
  esperar. O close carimba `PENDENTE` e retorna; o worker emite. O operador vê o status atualizar no extrato.
- **Cupom não-fiscal (recibo N1/N2) segue independente** — a impressão da iniciativa 1 **não** é a nota
  fiscal. A NFC-e tem seu próprio DANFE (via URL do emissor). Um não bloqueia o outro.
- **Duas chaves para emitir** — `FISCAL_EMISSION=true` (ambiente/worker) **e** `fiscalEnabled=true` (conta).
  Sobe **inerte**: mesmo com o código deployado, sem as duas chaves nada é emitido (segurança em multi-tenant).

---

## Decisões travadas (do mestre / conscientes)

- **Onda H = UM arquivo novo** `prisma/manual/2026-07-12-onda-h.sql`, idempotente, aplicado no Supabase SQL
  Editor pelo dono. Enums **novos** (`FiscalProvider`/`FiscalEnv`/`FiscalStatus`) não têm `CREATE TYPE IF NOT
  EXISTS` no Postgres → guarda por `DO $$ … EXCEPTION WHEN duplicate_object THEN null; END $$;`. Colunas com
  `ADD COLUMN IF NOT EXISTS`. Dev usa `prisma db push`; PROD só o `manual/*.sql`. **Nunca** duplicar
  manual×migration ([[prod-schema-drift-destravar]]).
- **Onda H > o previsto no mestre (desvio consciente).** O mestre listava só `Order.fiscalStatus`,
  `Order.fiscalDocId` e "credenciais cifradas em `User`". Este plano adiciona, no mesmo padrão de snapshot de
  fechamento e de idempotência já usado no projeto:
  - em `Order`: **`fiscalKey`** (chave de acesso 44 dígitos — exibir no extrato), **`fiscalDanfeUrl`** (URL do
    DANFE no emissor, p/ **reimpressão** — 13.3 não funciona sem ela), **`fiscalError`** (mensagem de
    rejeição — sem ela o operador não sabe por que falhou), **`fiscalRequestedAt`/`fiscalIssuedAt`** e
    **`fiscalAttempts`** (backoff/limite de retry — padrão `remindedDayBeforeAt`/marcador de idempotência).
  - em `User`, além da credencial cifrada: **`fiscalEnabled`** (opt-in — sem ele um flag global emitiria nota
    para toda conta no multi-tenant), **`fiscalEnv`** (homologação/produção — obrigatório p/ não emitir nota
    real em teste), **`fiscalSerie`**, **`fiscalCnpj`**, **`fiscalDefaultNcm`/`fiscalDefaultCfop`** (perfil
    mínimo p/ o emissor montar a nota). O cadastro tributário pesado fica **no emissor**.
- **BYOK cifrado, nunca em claro** — `fiscalKeyEnc` via `encryptSecret` (AES-256-GCM, `ENCRYPTION_KEY`),
  `fiscalKeyLast4` p/ exibir. Salvar **valida** contra o emissor antes de persistir (igual pagamento). Falha
  cedo se `isEncryptionConfigured` for false ([[strong-model-byok-only]]).
- **Emissor terceiro é a fonte da verdade fiscal** — nós nunca falamos com a SEFAZ direto; toda assinatura,
  CSC, contingência e cadastro tributário são do emissor. Isso é a essência de "sem construir a SEFAZ do zero".
- **Dinheiro em centavos** (`Int`) internamente; conversão para reais decimais **só na borda do emissor**
  (`centsToReaisString`), como o gateway de pagamento já faz ([[caixa-despesas-reposicionamento]]).
- **Tema:** só tokens/CSS vars, nunca hex fixo ([[design-tokens-dark-theme]]). **Tenancy:** credencial/perfil
  fiscal são do **DONO** (`ctx.tenantUserId`); editar exige `canSettings`. O status fiscal no extrato é
  leitura de qualquer operador (é dado da comanda), mas configurar o emissor é do dono.

---

## Coordenação (Onda H — isolada)

- **Onda H não compartilha arquivo com nenhuma outra onda** — é a última do roadmap, sem plano paralelo. Cria
  **`prisma/manual/2026-07-12-onda-h.sql`** (dono único do arquivo).
- **Depende de POS financeiro (iniciativa 2) em PROD** ([[../../docs/plans/2026-07-05-roadmap-multinegocio]]):
  a nota usa o **total derivado com ajustes** (`orderTotalCents`), os itens (`nameSnapshot`/`unitPriceCents`/
  `quantity`) e os tenders. Tudo já existe e está deployado (Onda A). Este plano **lê** desses campos e
  **acrescenta** os fiscais.
- **Convive com Estorno (iniciativa 4)**: estornar uma comanda com nota `EMITIDA` dispara best-effort de
  cancelamento fiscal (13.3, opcional). O `voidOrder` já existe ([[estorno-comanda-feito]]).
- Regra de ouro da onda ([[prod-schema-drift-destravar]]): dev = `db push` (pare o `next dev` —
  [[prisma-generate-dev-server-lock]]); PROD = **só** o `manual/*.sql` idempotente aplicado pelo dono no
  Supabase SQL Editor **antes** do deploy de código.

---

## Contexto de código (leia antes de começar)

- **Cripto BYOK:** [crypto.ts](../../src/server/crypto.ts) — `encryptSecret(plaintext)` / `decryptSecret(payload)`
  (AES-256-GCM, `ENCRYPTION_KEY` 64-hex). [env.ts:175](../../src/lib/env.ts#L175) `isEncryptionConfigured`.
- **Molde de credencial BYOK:** [payment-credential.service.ts](../../src/server/services/payment-credential.service.ts)
  — `getPaymentCredentialStatus`/`savePaymentCredential`/`removePaymentCredential`: valida contra o gateway,
  cifra, grava `last4`+`verifiedAt`. **Copie a forma** para `fiscal-credential.service`.
- **Molde de rota de credencial:** [api/account/payment-key/route.ts](../../src/app/api/account/payment-key/route.ts)
  — GET/POST/DELETE, `getTenantContext` → 401, `canSettings` → 403, zod, grava no `tenantUserId`.
- **Abstração de provedor:** [payments/gateway.ts](../../src/server/payments/gateway.ts) — `PaymentGateway`
  interface + `gatewayFor(provider)`; adaptadores em [asaas.ts](../../src/server/payments/asaas.ts) /
  [mercadopago.ts](../../src/server/payments/mercadopago.ts) (padrão de `fetch` + parse). **Espelhe** em
  `src/server/fiscal/`.
- **Fechamento (carimbo):** [order.service.ts:218-376](../../src/server/services/order.service.ts#L218-L376)
  `closeOrder` — dentro da tx, após a baixa de estoque, já grava snapshot de custo (L318-333) e comissão
  (L335-364). **Aqui** entra o carimbo `fiscalStatus=PENDENTE` (só se a conta é opt-in). `voidOrder`
  ([:384](../../src/server/services/order.service.ts#L384)) e `reopenOrder` ([:410](../../src/server/services/order.service.ts#L410)).
- **Total derivado:** `orderTotalCents({ items, discountCents, surchargeCents, tipCents })` no mesmo arquivo —
  base do valor da nota. **Nunca** desnormalize.
- **Worker (tick):** [worker/run.ts:150-244](../../src/server/worker/run.ts#L150-L244) — laço com blocos
  throttled + try/catch por tick; `dispatchLifecycleAutomations` (L223-231) é o **molde** do tick fiscal
  (kill-switch por env + throttle próprio + try/catch que não derruba os outros ticks).
- **Flags de env:** [env.ts:103-114](../../src/lib/env.ts#L103-L114) — `LIFECYCLE_AUTOMATION` (kill-switch
  `z.coerce.boolean().default(false)`) + `LIFECYCLE_EVERY_MS` (throttle). **Espelhe** `FISCAL_EMISSION` +
  `FISCAL_EVERY_MS` + `FISCAL_MAX_ATTEMPTS`.
- **Extrato (UI):** [SalesHistoryPanel.tsx](../../src/components/vendas/SalesHistoryPanel.tsx) — `Row`
  (L17-28: `status`, `closedAt`, `number`, totais), tabela de comandas fechadas; `canceled` (L233). **Aqui**
  entram a coluna/badge de status fiscal e o botão "DANFE".
- **Config da conta (UI):** [AccountSettings.tsx](../../src/components/app/AccountSettings.tsx) — já hospeda o
  BYOK de IA e de pagamento; a seção "Nota fiscal (NFC-e)" entra aqui, mesmo padrão de card.
- **Money:** [money.ts](../../src/lib/money.ts) — `formatCentsBRL`. A conversão cents→reais-string p/ o emissor
  é helper novo na borda fiscal.
- **Schema:** [prisma/schema.prisma](../../prisma/schema.prisma) — `User` (L122+, campos BYOK de pagamento
  L195-199 = modelo do bloco fiscal), `Order` (L384-429, snapshots de fechamento), enums no topo (L52-120).

### Convenções firmes (não desvie)
- **Multi-tenant:** credencial/perfil fiscal vivem no **dono** (`ownerId=null`); todo serviço recebe
  `accountId` (= `tenantUserId`) e filtra por ele.
- **Money em centavos** (`Int`) internamente; reais decimais **só** na chamada ao emissor.
- **Segredo nunca em claro / nunca em log** — `fiscalKeyEnc` cifrado; ao logar erro do emissor, **nunca** o
  token. `last4` só p/ exibir.
- **Idempotência do worker:** flip atômico `PENDENTE → PROCESSANDO` (`updateMany where fiscalStatus=PENDENTE`)
  antes de chamar o emissor, p/ dois workers/ticks não emitirem em dobro. `externalReference = order.id`
  (o emissor deduplica pela referência).
- **Idempotência do SQL:** tudo `IF NOT EXISTS`/guardado; um único `onda-h.sql`.
- **Pare o `next dev` antes** de `prisma db push`/`generate` (EPERM — [[prisma-generate-dev-server-lock]]).

### Padrão de teste (Vitest) — o estilo certo por arquivo
- **Lógica pura** (sem prisma/HTTP): `fiscal-emission.test.ts` (`nextFiscalAction`, backoff/limite),
  `centsToReaisString`. Import direto.
- **Prisma + emissor mockados** (`vi.mock("@/server/db/client")` + `vi.mock` do emissor, `await import()`
  dentro do `it`): `fiscal-credential.service.test.ts` (asserta cifra + validação) e
  `fiscal-emission.service.test.ts` (asserta flip atômico + gravação de status). Modelo: `offer.service.test.ts`.
- **Banco real** (`makeOwner()`): estender `order.service.test.ts` p/ o carimbo `fiscalStatus=PENDENTE` no
  fechamento (só quando `fiscalEnabled`).
- **Emissor real (Focus NFe)** — **não** testar contra a API de verdade; o adaptador é testado por unidade
  mockando `fetch` (como `payments/gateway.test.ts` faz), e o E2E usa o **mock emitter** via env.
- Rodar tudo: `npm test`. Um arquivo: `npx vitest run caminho.test.ts`. Commits pt-BR (`feat(fiscal): …`), um por tarefa.

---

# FASE 13.1 — Credencial BYOK do emissor + perfil fiscal (Onda H, sem emitir nada ainda)

**Resultado:** a conta configura o emissor terceiro (provedor + token validado + ambiente/série/NCM padrão)
nas Configurações, tudo cifrado. Nenhuma nota é emitida ainda — só schema, abstração de emissor, serviço de
credencial e UI. Zero impacto em produção (opt-in off, worker não mexido).

---

### Tarefa 13.1.1: Onda H começa — schema fiscal em `User` + `Order` + enums

**Files:**
- Create: `prisma/manual/2026-07-12-onda-h.sql` (**dono do arquivo**)
- Modify: `prisma/schema.prisma` (enums `FiscalProvider`/`FiscalEnv`/`FiscalStatus`; campos em `User` e `Order`)

**Step 1 — SQL idempotente.** Crie `prisma/manual/2026-07-12-onda-h.sql`:
```sql
-- Onda H (idempotente) — iniciativa 13 (Fiscal NFC-e via emissor terceiro).
-- BYOK cifrado do emissor + perfil fiscal da conta + status fiscal por comanda.
-- Aplicar no Supabase SQL Editor pelo dono ANTES do deploy de código.
-- Enums novos usam guarda por exception (CREATE TYPE não tem IF NOT EXISTS).
-- Reaplicável. NÃO duplicar com migration versionada. [[prod-schema-drift-destravar]]

-- ── enums novos (guarda idempotente) ──────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "FiscalProvider" AS ENUM ('FOCUS_NFE','PLUGNOTAS','TECNOSPEED');
  EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "FiscalEnv" AS ENUM ('HOMOLOGACAO','PRODUCAO');
  EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "FiscalStatus" AS ENUM ('PENDENTE','PROCESSANDO','EMITIDA','ERRO','CANCELADA');
  EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 13.1: credencial BYOK do emissor + perfil fiscal da conta (User, dono) ────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalProvider" "FiscalProvider";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalKeyEnc" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalKeyLast4" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalKeyVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalEnv" "FiscalEnv" NOT NULL DEFAULT 'HOMOLOGACAO';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalSerie" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalCnpj" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalDefaultNcm" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalDefaultCfop" TEXT;

-- ── 13.2: status fiscal por comanda (Order) ───────────────────────────────────
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalStatus" "FiscalStatus";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalDocId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalKey" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalDanfeUrl" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalError" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalRequestedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalIssuedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalAttempts" INTEGER NOT NULL DEFAULT 0;
-- o worker varre pendentes/processando por conta
CREATE INDEX IF NOT EXISTS "Order_accountId_fiscalStatus_idx" ON "Order"("accountId","fiscalStatus");
```
> Este arquivo já contém as colunas das três fases (13.1 credencial · 13.2 status · o resto reusa). É um SQL
> composto como a Onda G — pode aplicar inteiro de uma vez. `TIMESTAMP(3)` = o `DateTime` do Prisma.

**Step 2 — Schema + db push (dev).** Em `schema.prisma`, adicione os enums (perto dos outros, L52-120):
```prisma
enum FiscalProvider { FOCUS_NFE PLUGNOTAS TECNOSPEED }
enum FiscalEnv { HOMOLOGACAO PRODUCAO }
enum FiscalStatus { PENDENTE PROCESSANDO EMITIDA ERRO CANCELADA }
```
Em `User` (junto do BYOK de pagamento, L195-199):
```prisma
  // BYOK fiscal (Onda H): credencial do emissor terceiro (Focus NFe/PlugNotas/…) +
  // perfil fiscal mínimo. O cadastro tributário pesado (regime, CSC, certificado)
  // mora NO EMISSOR — aqui só o token da API + roteamento. Só faz sentido no dono.
  fiscalProvider      FiscalProvider?
  fiscalKeyEnc        String?   // token do emissor cifrado (AES-256-GCM): "iv:tag:ciphertext"
  fiscalKeyLast4      String?
  fiscalKeyVerifiedAt DateTime?
  fiscalEnabled       Boolean    @default(false) // opt-in por conta (2ª chave; a 1ª é FISCAL_EMISSION)
  fiscalEnv           FiscalEnv  @default(HOMOLOGACAO) // NUNCA emitir nota real em teste
  fiscalSerie         Int        @default(1)
  fiscalCnpj          String?    // CNPJ emitente (referência/exibição; a validade é do emissor)
  fiscalDefaultNcm    String?    // NCM padrão da conta (per-item ADIADO — ver Riscos)
  fiscalDefaultCfop   String?    // CFOP padrão (ex.: "5102" venda no estado)
```
Em `Order` (junto dos snapshots de fechamento, L404-424):
```prisma
  // Fiscal (Onda H): null = comanda não-fiscal (conta sem opt-in ou comanda antiga).
  // Emissão é ASSÍNCRONA no worker; o fechamento só carimba PENDENTE p/ conta opt-in.
  fiscalStatus      FiscalStatus?
  fiscalDocId       String?   // id do documento no emissor (ref p/ status/cancelamento)
  fiscalKey         String?   // chave de acesso NFC-e (44 díg.), snapshot p/ exibir
  fiscalDanfeUrl    String?   // URL do DANFE no emissor (reimpressão — 13.3)
  fiscalError       String?   // mensagem de rejeição (ERRO)
  fiscalRequestedAt DateTime?
  fiscalIssuedAt    DateTime?
  fiscalAttempts    Int       @default(0) // tentativas do worker (backoff/limite)
```
E no bloco de índices do `Order`: `@@index([accountId, fiscalStatus])`.
Pare o `next dev`, `npx prisma db push` + `npx prisma validate`.

**Step 3 — Commit.**
```bash
git add prisma/manual/2026-07-12-onda-h.sql prisma/schema.prisma
git commit -m "feat(fiscal): schema Onda H (credencial do emissor + status fiscal por comanda)"
```

---

### Tarefa 13.1.2: abstração de emissor `FiscalEmitter` + adaptador Focus NFe + mock

**Files:**
- Create: `src/server/fiscal/emitter.ts` (interface + `fiscalEmitterFor` + `centsToReaisString`)
- Create: `src/server/fiscal/focus-nfe.ts` (adaptador real)
- Create: `src/server/fiscal/mock.ts` (emissor de dev/teste, determinístico)
- Test: `src/server/fiscal/emitter.test.ts` (puro: `centsToReaisString`) + `src/server/fiscal/focus-nfe.test.ts` (mock de `fetch`, estilo `payments/gateway.test.ts`)

**Step 1 — Teste que falha (borda de dinheiro + roteamento).**
```ts
import { describe, it, expect } from "vitest";
import { centsToReaisString, fiscalEmitterFor } from "./emitter";

describe("fiscal emitter", () => {
  it("centsToReaisString formata centavos → reais com 2 casas (string, sem R$)", () => {
    expect(centsToReaisString(1000)).toBe("10.00");
    expect(centsToReaisString(1)).toBe("0.01");
    expect(centsToReaisString(123456)).toBe("1234.56");
  });
  it("fiscalEmitterFor devolve um emissor por provedor", () => {
    expect(fiscalEmitterFor("FOCUS_NFE")).toBeTruthy();
  });
});
```

**Step 2 — Rode e veja falhar.** `npx vitest run src/server/fiscal/emitter.test.ts` → FAIL.

**Step 3 — Implemente a interface + roteamento.** `src/server/fiscal/emitter.ts`:
```ts
import type { FiscalProvider, FiscalEnv } from "@prisma/client";
import { focusNfeEmitter } from "./focus-nfe";
import { mockFiscalEmitter } from "./mock";
import { env } from "@/lib/env";

/** Item da nota (valores em centavos internamente; a borda converte p/ reais). */
export interface NfceItem {
  name: string; quantity: number; unitPriceCents: number;
  ncm?: string | null; cfop?: string | null;
}
export interface EmitNfceInput {
  apiKey: string; fiscalEnv: FiscalEnv; serie: number; cnpj?: string | null;
  externalReference: string;            // = order.id (o emissor deduplica por ref)
  items: NfceItem[]; totalCents: number;
  customerName?: string | null; customerTaxId?: string | null; // CPF na nota (opcional)
  defaultNcm?: string | null; defaultCfop?: string | null;
}
/** Resultado normalizado — o mesmo shape p/ emitir e p/ consultar status. */
export interface NfceResult {
  status: "PROCESSANDO" | "EMITIDA" | "ERRO";
  docId?: string; accessKey?: string; danfeUrl?: string; error?: string;
}
export interface FiscalEmitter {
  /** Validação barata da credencial (usado ao salvar o token). */
  verifyCredential(apiKey: string, fiscalEnv: FiscalEnv): Promise<boolean>;
  /** Emite a NFC-e. Pode voltar PROCESSANDO (SEFAZ assíncrono) → resolve depois. */
  emitNfce(input: EmitNfceInput): Promise<NfceResult>;
  /** Consulta o status atual pelo docId (fonte de verdade). */
  getStatus(apiKey: string, fiscalEnv: FiscalEnv, docId: string): Promise<NfceResult>;
  /** Cancela (best-effort; janela legal curta). Opcional no v1. */
  cancelNfce(apiKey: string, fiscalEnv: FiscalEnv, docId: string, reason: string): Promise<NfceResult>;
}

/** Converte centavos → "reais.cc" (string, sem símbolo) p/ o payload do emissor. */
export function centsToReaisString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function fiscalEmitterFor(provider: FiscalProvider): FiscalEmitter {
  // FISCAL_MOCK força o emissor determinístico em dev/teste (sem tocar SEFAZ).
  if (env.FISCAL_MOCK) return mockFiscalEmitter;
  switch (provider) {
    case "FOCUS_NFE": return focusNfeEmitter;
    // PLUGNOTAS/TECNOSPEED: adaptadores futuros; por ora caem no não-implementado.
    default: throw new Error("Emissor fiscal ainda não suportado.");
  }
}
```

**Step 4 — Adaptador Focus NFe (real) + mock.** `focus-nfe.ts` implementa `FiscalEmitter` via `fetch`
(HTTP Basic com o token como usuário; base URL por ambiente: `homologacao.focusnfe.com.br` vs
`api.focusnfe.com.br`). Monta o payload NFC-e (`natureza_operacao`, `items[]` com `numero_item`, `codigo_ncm`
= item.ncm ?? defaultNcm, `cfop` = item.cfop ?? defaultCfop, `valor_unitario_comercial` =
`centsToReaisString(unitPriceCents)`, `quantidade_comercial`). `emitNfce` faz POST com `ref=externalReference`;
Focus retorna `status: "processando_autorizacao" | "autorizado" | "erro_autorizacao"` → normaliza p/
`PROCESSANDO`/`EMITIDA`/`ERRO`, extrai `chave_nfe` (accessKey), `caminho_danfe`/`url` (danfeUrl) e a mensagem
de rejeição. `getStatus` faz GET `/v2/nfce/{ref}`. `verifyCredential` faz um GET barato autenticado (ex.:
`/v2/empresas`) → true no 200. **Nunca** logar o token. Testar com `fetch` mockado (respostas de exemplo),
asserindo o mapeamento de status e a conversão de dinheiro. `mock.ts` é determinístico (sem HTTP):
`verifyCredential` → `apiKey.length >= 12`; `emitNfce` → `EMITIDA` com `docId="mock-"+ref`,
`accessKey="0".repeat(44)`, `danfeUrl="https://exemplo/danfe/"+ref` (ou `ERRO` se algum item sem preço, p/
exercitar o caminho de erro no E2E).

**Step 5 — Env.** Em [env.ts](../../src/lib/env.ts), adicione:
```ts
FISCAL_MOCK: z.coerce.boolean().default(false), // dev/teste: emissor determinístico, não toca SEFAZ
```

**Step 6 — Rode e veja passar.** `npx vitest run src/server/fiscal` → PASS.

**Step 7 — Commit.**
```bash
git add src/server/fiscal src/lib/env.ts
git commit -m "feat(fiscal): abstração de emissor (Focus NFe + mock) e conversão de dinheiro"
```

---

### Tarefa 13.1.3: `fiscal-credential.service` — validar + cifrar + perfil fiscal (TDD)

**Files:**
- Create: `src/server/services/fiscal-credential.service.ts`
- Test: `src/server/services/fiscal-credential.service.test.ts` (prisma + emissor mockados, estilo `offer.service.test.ts`)

**Step 1 — Teste que falha.**
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/server/db/client", () => ({ prisma: { user: { update: vi.fn(), findUnique: vi.fn() } } }));
vi.mock("@/server/crypto", () => ({ encryptSecret: (s: string) => `enc(${s})` }));
vi.mock("@/lib/env", () => ({ isEncryptionConfigured: true, env: { FISCAL_MOCK: true } }));
vi.mock("@/server/fiscal/emitter", async (orig) => ({
  ...(await orig<any>()),
  fiscalEmitterFor: () => ({ verifyCredential: vi.fn().mockResolvedValue(true) }),
}));

describe("saveFiscalCredential", () => {
  beforeEach(() => vi.clearAllMocks());
  it("valida no emissor, cifra o token e grava last4 + verifiedAt", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ fiscalProvider: "FOCUS_NFE", fiscalKeyLast4: "cdef", fiscalEnabled: false, fiscalKeyVerifiedAt: new Date() });
    const { saveFiscalCredential } = await import("./fiscal-credential.service");
    await saveFiscalCredential("u1", "FOCUS_NFE", "token-abc-123456", "HOMOLOGACAO");
    const arg = (prisma.user.update as any).mock.calls[0][0].data;
    expect(arg.fiscalKeyEnc).toBe("enc(token-abc-123456)");
    expect(arg.fiscalKeyLast4).toBe("3456");
    expect(arg.fiscalProvider).toBe("FOCUS_NFE");
    expect(arg.fiscalKeyVerifiedAt).toBeInstanceOf(Date);
  });
  it("token que não valida no emissor → erro amigável, não grava", async () => {
    const { fiscalEmitterFor } = await import("@/server/fiscal/emitter");
    (fiscalEmitterFor as any) = () => ({ verifyCredential: vi.fn().mockResolvedValue(false) });
    // ... asserta rejects e prisma.user.update não chamado
  });
});
```

**Step 2 — Rode e veja falhar.** `-t saveFiscalCredential` → FAIL.

**Step 3 — Implemente** (espelha `payment-credential.service`):
```ts
import { prisma } from "@/server/db/client";
import { isEncryptionConfigured } from "@/lib/env";
import { encryptSecret } from "@/server/crypto";
import { fiscalEmitterFor } from "@/server/fiscal/emitter";
import type { FiscalProvider, FiscalEnv } from "@prisma/client";

export interface FiscalCredentialStatus {
  configured: boolean; provider: FiscalProvider | null; last4: string | null;
  verifiedAt: string | null; enabled: boolean; env: FiscalEnv;
}

export async function getFiscalCredentialStatus(userId: string): Promise<FiscalCredentialStatus> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { fiscalProvider: true, fiscalKeyLast4: true, fiscalKeyVerifiedAt: true, fiscalEnabled: true, fiscalEnv: true },
  });
  return {
    configured: !!u?.fiscalProvider, provider: u?.fiscalProvider ?? null,
    last4: u?.fiscalKeyLast4 ?? null,
    verifiedAt: u?.fiscalKeyVerifiedAt ? u.fiscalKeyVerifiedAt.toISOString() : null,
    enabled: !!u?.fiscalEnabled, env: u?.fiscalEnv ?? "HOMOLOGACAO",
  };
}

/** Valida o token contra o emissor e persiste cifrado. NÃO liga a emissão (opt-in é à parte). */
export async function saveFiscalCredential(
  userId: string, provider: FiscalProvider, apiKey: string, fiscalEnv: FiscalEnv,
): Promise<FiscalCredentialStatus> {
  const key = apiKey.trim();
  if (key.length < 12) throw new Error("Token do emissor fiscal inválido.");
  if (!isEncryptionConfigured) throw new Error("Recurso indisponível no momento. Tente novamente mais tarde.");
  let ok = false;
  try { ok = await fiscalEmitterFor(provider).verifyCredential(key, fiscalEnv); } catch { ok = false; }
  if (!ok) throw new Error("Não consegui validar o token no emissor. Confira o provedor e a chave.");
  await prisma.user.update({
    where: { id: userId },
    data: {
      fiscalProvider: provider, fiscalKeyEnc: encryptSecret(key), fiscalKeyLast4: key.slice(-4),
      fiscalKeyVerifiedAt: new Date(), fiscalEnv,
    },
  });
  return getFiscalCredentialStatus(userId);
}

/** Perfil fiscal (série, CNPJ, NCM/CFOP padrão) + liga/desliga o opt-in. */
export async function setFiscalProfile(userId: string, patch: {
  fiscalEnabled?: boolean; fiscalSerie?: number; fiscalCnpj?: string | null;
  fiscalDefaultNcm?: string | null; fiscalDefaultCfop?: string | null;
}): Promise<FiscalCredentialStatus> {
  // Ligar exige credencial já configurada (senão o worker não teria com o que emitir).
  if (patch.fiscalEnabled) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { fiscalProvider: true } });
    if (!u?.fiscalProvider) throw new Error("Configure o emissor fiscal antes de ligar a emissão.");
  }
  await prisma.user.update({ where: { id: userId }, data: { ...patch } });
  return getFiscalCredentialStatus(userId);
}

export async function removeFiscalCredential(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { fiscalProvider: null, fiscalKeyEnc: null, fiscalKeyLast4: null, fiscalKeyVerifiedAt: null, fiscalEnabled: false },
  });
}
```

**Step 4 — Rode e veja passar.** → PASS.

**Step 5 — Commit.**
```bash
git add src/server/services/fiscal-credential.service.ts src/server/services/fiscal-credential.service.test.ts
git commit -m "feat(fiscal): serviço de credencial BYOK do emissor (validar + cifrar + perfil)"
```

---

### Tarefa 13.1.4: API `/api/account/fiscal-key` + seção "Nota fiscal (NFC-e)" nas Configurações

**Files:**
- Create: `src/app/api/account/fiscal-key/route.ts` (GET/POST/PATCH/DELETE)
- Modify: `src/components/app/AccountSettings.tsx` (card "Nota fiscal (NFC-e)")

**Step 1 — Rota (espelha `payment-key/route.ts`).** `dynamic="force-dynamic"`; `getTenantContext` → 401;
`canSettings` → 403; grava no `ctx.tenantUserId`.
- **GET** → `getFiscalCredentialStatus` (+ o perfil: série/CNPJ/NCM/CFOP p/ preencher o form).
- **POST** (zod: `provider ∈ {FOCUS_NFE,PLUGNOTAS,TECNOSPEED}`, `apiKey min 12`, `env ∈ {HOMOLOGACAO,PRODUCAO}`)
  → `saveFiscalCredential` → try/catch → 400 com a mensagem.
- **PATCH** (zod: `fiscalEnabled?`, `fiscalSerie? int>=1`, `fiscalCnpj?`, `fiscalDefaultNcm?`, `fiscalDefaultCfop?`)
  → `setFiscalProfile` → 400 em erro (ex.: ligar sem credencial).
- **DELETE** → `removeFiscalCredential`.

**Step 2 — UI.** No `AccountSettings`, um card "Nota fiscal (NFC-e)" no mesmo padrão do BYOK de pagamento:
seletor de provedor, campo de token (mostra só `•••• last4` quando salvo), toggle **ambiente
homologação/produção** (com aviso claro: "Produção emite nota real"), campos série/CNPJ/NCM padrão/CFOP padrão,
switch **"Emitir NFC-e no fechamento"** (`fiscalEnabled`) — desabilitado até haver credencial validada. Só
tokens/CSS vars ([[design-tokens-dark-theme]]). Aviso inline quando `FISCAL_EMISSION` (global) está off:
"Emissão em implantação — sua conta está pronta, ligamos globalmente em breve" (opcional; o worker é a 2ª
chave).

**Step 3 — Verifique.** `npm run dev`: com `FISCAL_MOCK=true`, salvar um token (≥12 chars) valida e mostra
`•••• 3456`; ligar o switch sem credencial → erro; com credencial → liga. Skill `verify`.

**Step 4 — Commit.**
```bash
git add src/app/api/account/fiscal-key src/components/app/AccountSettings.tsx
git commit -m "feat(fiscal): configuração do emissor NFC-e nas Configurações (BYOK)"
```

> **Fim da Fase 13.1:** a conta configura e liga o opt-in, mas **nada é emitido** — o carimbo no fechamento
> (13.2) e o worker ainda não existem. Zero impacto em PROD (sobe inerte).

---

# FASE 13.2 — Emissão assíncrona no fechamento (carimbo + tick no worker)

**Resultado:** ao fechar uma comanda numa conta opt-in, ela nasce `fiscalStatus=PENDENTE`; o worker drena os
pendentes, chama o emissor e resolve para `EMITIDA`/`ERRO`, re-consultando os `PROCESSANDO`. Duas chaves
(`FISCAL_EMISSION` global + `fiscalEnabled` da conta). Sobe **inerte**.

---

### Tarefa 13.2.1: carimbo `fiscalStatus=PENDENTE` no fechamento (só conta opt-in)

**Files:**
- Modify: `src/server/services/order.service.ts` (`closeOrder`)
- Test: `src/server/services/order.service.test.ts` (**banco real; ESTENDA**)

**Step 1 — Teste que falha (banco real).**
```ts
it("closeOrder carimba fiscalStatus=PENDENTE só quando a conta é opt-in", async () => {
  const acc = await makeOwner();
  const prod = await createCatalogItem(acc, { name: "Bola", priceCents: 5000, kind: "PRODUTO" });
  // conta SEM opt-in → fica null
  const o1 = await createOrder(acc, { openedById: acc });
  await addOrderItem(acc, o1.id, { catalogItemId: prod.id, quantity: 1 });
  await closeOrder(acc, o1.id, { payment: "DINHEIRO", closedById: acc });
  expect((await prisma.order.findUnique({ where: { id: o1.id } }))!.fiscalStatus).toBeNull();
  // liga o opt-in → próxima comanda nasce PENDENTE
  await prisma.user.update({ where: { id: acc }, data: { fiscalEnabled: true } });
  const o2 = await createOrder(acc, { openedById: acc });
  await addOrderItem(acc, o2.id, { catalogItemId: prod.id, quantity: 1 });
  await closeOrder(acc, o2.id, { payment: "DINHEIRO", closedById: acc });
  const r2 = await prisma.order.findUnique({ where: { id: o2.id } });
  expect(r2!.fiscalStatus).toBe("PENDENTE");
  expect(r2!.fiscalRequestedAt).toBeInstanceOf(Date);
});
```

**Step 2 — Rode e veja falhar.** `-t "carimba fiscalStatus"` → FAIL (fica null).

**Step 3 — Implemente.** Em `closeOrder`, **dentro da tx**, no mesmo bloco onde grava o `updateMany` de
fechamento (L301-308), some o carimbo fiscal. Faça UMA leitura barata do opt-in da conta (PK indexada):
```ts
// ── Fiscal (Onda H): carimbo de emissão PENDENTE p/ conta opt-in ─────────────
// O opt-in (User.fiscalEnabled) é a 2ª chave; a emissão real roda no worker
// (assíncrona — SEFAZ é lento). Conta sem opt-in → fiscalStatus fica null
// (comanda não-fiscal). Uma comanda fechada ANTES de ligar o opt-in nunca é
// emitida retroativamente (só quem nasce com o carimbo).
const acct = await tx.user.findUnique({ where: { id: accountId }, select: { fiscalEnabled: true } });
// ...no data do updateMany de fechamento, adicione:
//   ...(acct?.fiscalEnabled ? { fiscalStatus: "PENDENTE", fiscalRequestedAt: new Date() } : {}),
```
> Coloque a leitura junto do lookup de `openSession` (mesma região da tx) e o spread no `data` do `updateMany`.
> **`reopenOrder`:** ao reabrir, limpe os campos fiscais (`fiscalStatus: null`, `fiscalRequestedAt: null` etc.)
> **só se** ainda `PENDENTE` (não emitida) — uma nota já `EMITIDA` **não** pode ser silenciosamente descartada
> (é a via do estorno/cancelamento em 13.3). Trave num teste.

**Step 4 — Rode e veja passar.** → PASS.

**Step 5 — Commit.**
```bash
git add src/server/services/order.service.ts src/server/services/order.service.test.ts
git commit -m "feat(fiscal): carimbo de emissão PENDENTE no fechamento (opt-in por conta)"
```

---

### Tarefa 13.2.2: `nextFiscalAction` — política pura de retry/backoff (TDD)

**Files:**
- Create: `src/server/services/fiscal-emission.ts` (puro)
- Test: `src/server/services/fiscal-emission.test.ts`

**Step 1 — Teste que falha.**
```ts
import { describe, it, expect } from "vitest";
import { nextFiscalAction } from "./fiscal-emission";

const MAX = 5;
describe("nextFiscalAction", () => {
  it("PENDENTE → EMITIR", () => {
    expect(nextFiscalAction({ status: "PENDENTE", attempts: 0 }, MAX)).toBe("EMITIR");
  });
  it("PROCESSANDO → CONSULTAR (aguarda SEFAZ)", () => {
    expect(nextFiscalAction({ status: "PROCESSANDO", attempts: 1 }, MAX)).toBe("CONSULTAR");
  });
  it("ERRO abaixo do limite → EMITIR (retry); no limite → DESISTIR", () => {
    expect(nextFiscalAction({ status: "ERRO", attempts: 2 }, MAX)).toBe("EMITIR");
    expect(nextFiscalAction({ status: "ERRO", attempts: MAX }, MAX)).toBe("DESISTIR");
  });
  it("EMITIDA/CANCELADA → NADA (terminal)", () => {
    expect(nextFiscalAction({ status: "EMITIDA", attempts: 1 }, MAX)).toBe("NADA");
    expect(nextFiscalAction({ status: "CANCELADA", attempts: 1 }, MAX)).toBe("NADA");
  });
});
```

**Step 2 — Rode e veja falhar.** → FAIL.

**Step 3 — Implemente (puro).**
```ts
import type { FiscalStatus } from "@prisma/client";
export type FiscalAction = "EMITIR" | "CONSULTAR" | "DESISTIR" | "NADA";

/** Decide o próximo passo do worker para uma comanda fiscal. Puro e testável. */
export function nextFiscalAction(o: { status: FiscalStatus; attempts: number }, maxAttempts: number): FiscalAction {
  switch (o.status) {
    case "PENDENTE": return "EMITIR";
    case "PROCESSANDO": return "CONSULTAR";
    case "ERRO": return o.attempts >= maxAttempts ? "DESISTIR" : "EMITIR";
    case "EMITIDA":
    case "CANCELADA": return "NADA";
    default: return "NADA";
  }
}
```
> **Retry manual vs automático (decisão):** o worker **não** re-tenta `ERRO` automaticamente para não
> martelar a SEFAZ com uma nota malformada (ex.: NCM inválido) — `ERRO` sai da fila (o worker só puxa
> `PENDENTE`/`PROCESSANDO`). A `attempts`/`DESISTIR` cobre o caso de o operador **re-enfileirar** manualmente
> (13.3: botão "Tentar de novo" que volta `PENDENTE` e incrementa `attempts` até o teto). Isso mantém o
> `nextFiscalAction` como a política única e o worker simples.

**Step 4 — Rode e veja passar.** → PASS.

**Step 5 — Commit.**
```bash
git add src/server/services/fiscal-emission.ts src/server/services/fiscal-emission.test.ts
git commit -m "feat(fiscal): política pura de emissão/retry (nextFiscalAction)"
```

---

### Tarefa 13.2.3: `fiscal-emission.service` — drena pendentes e resolve status (TDD)

**Files:**
- Modify: `src/server/services/fiscal-emission.ts` (adiciona `dispatchPendingFiscalEmissions`)
- Test: `src/server/services/fiscal-emission.service.test.ts` (prisma + emissor + crypto mockados)
- Modify: `src/lib/env.ts` (`FISCAL_EMISSION`, `FISCAL_EVERY_MS`, `FISCAL_MAX_ATTEMPTS`)

**Step 1 — Env.** Espelhe o bloco do lifecycle ([env.ts:103-114](../../src/lib/env.ts#L103-L114)):
```ts
// Emissão fiscal (NFC-e via emissor terceiro). FISCAL_EMISSION é o KILL-SWITCH
// global: false = nada é emitido (sobe inerte). A 2ª chave é o opt-in por conta
// (User.fiscalEnabled). As duas precisam estar ligadas. FISCAL_MOCK (13.1.2) usa
// o emissor determinístico sem tocar SEFAZ.
FISCAL_EMISSION: z.coerce.boolean().default(false),
FISCAL_EVERY_MS: z.coerce.number().int().positive().default(60_000), // 1 min: SEFAZ é lento
FISCAL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
```

**Step 2 — Teste que falha (kill-switch + flip atômico + gravação).**
```ts
vi.mock("@/lib/env", () => ({ env: { FISCAL_EMISSION: true, FISCAL_MAX_ATTEMPTS: 5, FISCAL_MOCK: true } }));
vi.mock("@/server/crypto", () => ({ decryptSecret: (s: string) => s.replace("enc(", "").replace(")", "") }));
// prisma: order.findMany (pendentes), order.updateMany (flip atômico), order.update (resultado), user.findUnique
// emitter: fiscalEmitterFor().emitNfce → EMITIDA
it("kill-switch off → não faz nada", async () => {/* FISCAL_EMISSION=false → retorna 0, sem queries */});
it("emite um PENDENTE: flip atômico p/ PROCESSANDO, chama o emissor, grava EMITIDA+chave+danfe", async () => {
  // asserta: updateMany({ where:{ id, fiscalStatus:"PENDENTE" }, data:{ fiscalStatus:"PROCESSANDO", ... }})
  //          order.update com fiscalStatus:"EMITIDA", fiscalKey, fiscalDanfeUrl, fiscalIssuedAt
});
it("flip que afeta 0 linhas (outro worker pegou) → não chama o emissor", async () => {/* updateMany count=0 → skip */});
```

**Step 3 — Implemente.**
```ts
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { decryptSecret } from "@/server/crypto";
import { fiscalEmitterFor, type EmitNfceInput } from "@/server/fiscal/emitter";
import { orderTotalCents } from "./order.service";
import { logger } from "@/lib/logger";

/** Drena as comandas fiscais pendentes/processando das contas opt-in. Retorna quantas resolveu. */
export async function dispatchPendingFiscalEmissions(now: Date): Promise<number> {
  if (!env.FISCAL_EMISSION) return 0; // kill-switch global
  const orders = await prisma.order.findMany({
    where: {
      fiscalStatus: { in: ["PENDENTE", "PROCESSANDO"] },
      account: { fiscalEnabled: true, fiscalProvider: { not: null }, fiscalKeyEnc: { not: null } },
    },
    include: { items: true, account: {
      select: { fiscalProvider: true, fiscalKeyEnc: true, fiscalEnv: true, fiscalSerie: true,
                fiscalCnpj: true, fiscalDefaultNcm: true, fiscalDefaultCfop: true },
    } },
    take: 25, // lote pequeno; o throttle do worker repete
  });
  let done = 0;
  for (const o of orders) {
    const a = o.account;
    const emitter = fiscalEmitterFor(a.fiscalProvider!);
    const apiKey = decryptSecret(a.fiscalKeyEnc!);
    try {
      if (o.fiscalStatus === "PENDENTE") {
        // Flip atômico: só um worker/tick emite esta comanda (evita nota em dobro).
        const claimed = await prisma.order.updateMany({
          where: { id: o.id, fiscalStatus: "PENDENTE" },
          data: { fiscalStatus: "PROCESSANDO", fiscalAttempts: { increment: 1 } },
        });
        if (claimed.count === 0) continue; // outro tick pegou
        const total = orderTotalCents({ items: o.items, discountCents: o.discountCents, surchargeCents: o.surchargeCents, tipCents: o.tipCents });
        const input: EmitNfceInput = {
          apiKey, fiscalEnv: a.fiscalEnv, serie: a.fiscalSerie, cnpj: a.fiscalCnpj,
          externalReference: o.id, totalCents: total,
          items: o.items.map((it) => ({ name: it.nameSnapshot, quantity: it.quantity, unitPriceCents: it.unitPriceCents })),
          customerName: o.customerName, defaultNcm: a.fiscalDefaultNcm, defaultCfop: a.fiscalDefaultCfop,
        };
        const r = await emitter.emitNfce(input);
        await applyResult(o.id, r);
      } else {
        // PROCESSANDO: re-consulta o emissor (SEFAZ resolveu?).
        if (!o.fiscalDocId) continue;
        const r = await emitter.getStatus(apiKey, a.fiscalEnv, o.fiscalDocId);
        await applyResult(o.id, r);
      }
      done++;
    } catch (err) {
      // Nunca logar o token. Falha de rede → volta a PENDENTE p/ o próximo tick tentar.
      logger.error({ orderId: o.id, err }, "[worker] emissão fiscal falhou");
      await prisma.order.updateMany({ where: { id: o.id, fiscalStatus: "PROCESSANDO" }, data: { fiscalStatus: "PENDENTE" } });
    }
  }
  return done;
}

async function applyResult(orderId: string, r: { status: string; docId?: string; accessKey?: string; danfeUrl?: string; error?: string }) {
  await prisma.order.update({
    where: { id: orderId },
    data: {
      fiscalStatus: r.status as any, // "EMITIDA" | "ERRO" | "PROCESSANDO"
      fiscalDocId: r.docId ?? undefined,
      fiscalKey: r.accessKey ?? undefined,
      fiscalDanfeUrl: r.danfeUrl ?? undefined,
      fiscalError: r.status === "ERRO" ? (r.error ?? "Rejeitada pelo emissor.") : null,
      fiscalIssuedAt: r.status === "EMITIDA" ? new Date() : undefined,
    },
  });
}
```
> **Concorrência:** o `fiscalAttempts: { increment: 1 }` no flip (não no `applyResult`) conta cada tentativa de
> **emitir**; `DESISTIR` (13.2.2) usa esse contador. O `updateMany where fiscalStatus=PENDENTE` é a guarda
> atômica (mesmo padrão do fechamento). `externalReference=order.id` faz o emissor deduplicar mesmo se dois
> ticks passarem.

**Step 4 — Rode e veja passar.** → PASS.

**Step 5 — Commit.**
```bash
git add src/server/services/fiscal-emission.ts src/server/services/fiscal-emission.service.test.ts src/lib/env.ts
git commit -m "feat(fiscal): worker service drena emissões pendentes (flip atômico + status)"
```

---

### Tarefa 13.2.4: tick no worker

**Files:**
- Modify: `src/server/worker/run.ts`

**Step 1 — Implemente** (espelha o bloco `dispatchLifecycleAutomations`, [run.ts:223-231](../../src/server/worker/run.ts#L223-L231)).
Import no topo + `let lastFiscal = 0;` junto dos outros throttles (L144-149), e dentro do `while`:
```ts
// Emissão fiscal (NFC-e). No-op se FISCAL_EMISSION=false (kill-switch) — sobe inerte.
// Throttle próprio (default 1 min): SEFAZ é lento, não precisa a cada poll. Try/catch
// próprio: falha aqui não derruba os outros ticks. Roda nos dois modos (baileys/cloud).
if (Date.now() - lastFiscal >= env.FISCAL_EVERY_MS) {
  try {
    const n = await dispatchPendingFiscalEmissions(new Date());
    if (n > 0) logger.info({ resolved: n }, "[worker] emissões fiscais resolvidas");
  } catch (err) {
    logger.error({ err }, "[worker] dispatchPendingFiscalEmissions falhou");
  }
  lastFiscal = Date.now();
}
```
> Coloque o bloco **antes** do `if (env.WHATSAPP_MODE === "baileys") { … continue; }` (L246) para rodar nos
> dois modos, igual o lifecycle.

**Step 2 — Verifique.** `npm run dev` do worker com `FISCAL_EMISSION=true FISCAL_MOCK=true`: feche uma comanda
numa conta opt-in → em ~1 min o `fiscalStatus` vira `EMITIDA` com `fiscalKey`/`fiscalDanfeUrl` (mock). Sem
`FISCAL_EMISSION` → fica `PENDENTE` (inerte). `npm test` verde.

**Step 3 — Commit.**
```bash
git add src/server/worker/run.ts
git commit -m "feat(fiscal): tick de emissão fiscal no worker (gated por FISCAL_EMISSION)"
```

> **Fim da Fase 13.2:** com as duas chaves ligadas, o fechamento vira nota assíncrona. Sem elas, nada muda.

---

# FASE 13.3 — Status fiscal + DANFE no extrato (+ cancelamento best-effort)

**Resultado:** o operador vê o status fiscal de cada comanda no extrato, abre/reimprime o **DANFE**, e
**re-tenta** uma emissão em `ERRO`. Estornar uma comanda com nota `EMITIDA` dispara o **cancelamento
best-effort** no emissor.

---

### Tarefa 13.3.1: status fiscal na API do extrato + badge/coluna + DANFE

**Files:**
- Modify: `src/app/api/vendas/orders/route.ts` (ou o handler do histórico) — devolver campos fiscais
- Modify: `src/components/vendas/SalesHistoryPanel.tsx` (badge de status + botão "DANFE")

**Step 1 — API.** No `select`/DTO do histórico de comandas fechadas, inclua `fiscalStatus`, `fiscalKey`,
`fiscalDanfeUrl`, `fiscalError`. Sem lógica nova — só expor.

**Step 2 — UI.** No `Row` (L17-28) adicione os campos; na tabela, uma coluna/badge de status fiscal:
`PENDENTE`/`PROCESSANDO` → "emitindo…" (tom neutro), `EMITIDA` → verde com link **"DANFE"** (`fiscalDanfeUrl`
em nova aba) + a `fiscalKey` no title, `ERRO` → vermelho com o `fiscalError` no tooltip + botão **"Tentar de
novo"** (13.3.2), `CANCELADA` → riscado "nota cancelada". `null` (não-fiscal) → sem badge. Só tokens/CSS vars
([[design-tokens-dark-theme]]). O extrato já recarrega ao paginar; o status atualiza no refresh (sem SSE novo
no v1 — o operador atualiza a aba; documentado).

**Step 3 — Verifique.** `npm run dev` (mock): comanda emitida mostra o badge verde + DANFE; forçar erro no
mock mostra o vermelho + motivo. Skill `verify`.

**Step 4 — Commit.**
```bash
git add src/app/api/vendas/orders src/components/vendas/SalesHistoryPanel.tsx
git commit -m "feat(fiscal): status fiscal e DANFE no extrato de comandas"
```

---

### Tarefa 13.3.2: re-enfileirar emissão em ERRO (botão "Tentar de novo")

**Files:**
- Modify: `src/server/services/fiscal-emission.ts` (`retryFiscalEmission`)
- Create: `src/app/api/vendas/orders/[id]/fiscal/route.ts` (POST retry)
- Test: `src/server/services/fiscal-emission.service.test.ts` (**ESTENDA**)
- Modify: `src/components/vendas/SalesHistoryPanel.tsx` (liga o botão)

**Step 1 — Serviço + teste.** `retryFiscalEmission(accountId, orderId)`: só age em `fiscalStatus=ERRO` e
`fiscalAttempts < FISCAL_MAX_ATTEMPTS` (senão erro amigável "Limite de tentativas atingido — verifique os
dados fiscais com seu contador."); escopo por conta; volta `fiscalStatus="PENDENTE"`, limpa `fiscalError`.
O worker faz o resto.
```ts
export async function retryFiscalEmission(accountId: string, orderId: string): Promise<void> {
  const res = await prisma.order.updateMany({
    where: { id: orderId, accountId, fiscalStatus: "ERRO", fiscalAttempts: { lt: env.FISCAL_MAX_ATTEMPTS } },
    data: { fiscalStatus: "PENDENTE", fiscalError: null },
  });
  if (res.count === 0) throw new Error("Não é possível reemitir esta nota (verifique o status e o limite de tentativas).");
}
```

**Step 2 — Rota.** POST `/api/vendas/orders/[id]/fiscal` (retry) → `getTenantContext` → 401; qualquer operador
pode re-tentar (é ação de caixa) — ou gateie por `canSettings` se preferir (decida e trave num teste). Chama
`retryFiscalEmission(ctx.tenantUserId, id)` → 200/400.

**Step 3 — UI.** O botão "Tentar de novo" no badge de `ERRO` chama a rota e mostra "reenfileirado".

**Step 4 — Verifique + Commit.** `npm test` + `verify`.
```bash
git add src/server/services/fiscal-emission.ts src/server/services/fiscal-emission.service.test.ts src/app/api/vendas/orders src/components/vendas/SalesHistoryPanel.tsx
git commit -m "feat(fiscal): reemitir NFC-e em erro (retry manual com limite)"
```

---

### Tarefa 13.3.3 (opcional): cancelamento fiscal best-effort no estorno

**Files:**
- Modify: `src/server/services/order.service.ts` (`voidOrder`)
- Modify: `src/server/services/fiscal-emission.ts` (branch de cancelamento no tick)
- Test: `order.service.test.ts` + `fiscal-emission.service.test.ts`

**Step 1 — Marcar no estorno.** Em `voidOrder`, se a comanda tinha `fiscalStatus="EMITIDA"`, **não** apague a
nota: registre a intenção de cancelar. Decisão simples: adicione o valor de enum **não** (evite alterar enum
agora) — em vez disso, reuse `fiscalStatus="PENDENTE"` **não** serve (é emissão). Trave a decisão: mantenha
`fiscalStatus="EMITIDA"` e trate o cancelamento como uma **ação separada** disparada pelo estorno via um
campo/flag simples, OU faça o `voidOrder` chamar direto o emissor de forma síncrona (best-effort, dentro do
try/catch, sem travar o estorno se falhar). **Recomendado v1:** best-effort **síncrono** no `voidOrder`
(fora da tx, após o commit do estorno):
```ts
// Após o estorno commitado, tenta cancelar a NFC-e (janela legal ~30 min). Best-effort:
// falha aqui NÃO desfaz o estorno (o contador resolve o resto). Nunca logar o token.
if (order.fiscalStatus === "EMITIDA" && order.fiscalDocId) {
  try {
    const acct = await prisma.user.findUnique({ where: { id: accountId }, select: { fiscalProvider: true, fiscalKeyEnc: true, fiscalEnv: true } });
    if (acct?.fiscalProvider && acct.fiscalKeyEnc) {
      const r = await fiscalEmitterFor(acct.fiscalProvider).cancelNfce(decryptSecret(acct.fiscalKeyEnc), acct.fiscalEnv, order.fiscalDocId, reason);
      await prisma.order.update({ where: { id: orderId }, data: { fiscalStatus: r.status === "EMITIDA" ? "CANCELADA" : "EMITIDA", fiscalError: r.error ?? null } });
    }
  } catch (err) { logger.error({ orderId, err }, "[fiscal] cancelamento no estorno falhou (janela?)"); }
}
```
> **Escopo:** isto é síncrono e best-effort de propósito — o estorno já commitou. Se a janela legal passou, a
> nota fica `EMITIDA` com aviso; o contador emite a devolução. Robustez total (fila de cancelamento no worker)
> é follow-up. Se preferir **não** incluir no v1, pule esta tarefa: o cancelamento fiscal vira processo manual
> pelo painel do emissor. Documente a escolha.

**Step 2 — Teste (mock emitter).** Estorno de comanda `EMITIDA` → `cancelNfce` chamado → status `CANCELADA`;
falha do emissor → permanece `EMITIDA` sem derrubar o estorno.

**Step 3 — Commit.**
```bash
git commit -am "feat(fiscal): cancelamento best-effort da NFC-e no estorno de comanda"
```

---

## Verificação de ponta a ponta (antes de fechar)

1. `npm test` inteiro verde + `npx tsc --noEmit` limpo + `npm run lint` sem erros novos.
2. **Config (13.1):** salvar token (`FISCAL_MOCK=true`) valida e mostra `•••• last4`; ligar a emissão sem
   credencial → erro; produção vs homologação alterna com aviso.
3. **Emissão (13.2):** com `FISCAL_EMISSION=true FISCAL_MOCK=true` e conta opt-in, fechar comanda → nasce
   `PENDENTE` → em ~1 min vira `EMITIDA` com `fiscalKey`/`fiscalDanfeUrl`. Sem `FISCAL_EMISSION` → fica
   `PENDENTE` (inerte). Conta **sem** opt-in → `fiscalStatus` null (não-fiscal), sem 500.
4. **Idempotência:** dois ticks/instâncias não emitem em dobro (flip atômico `PENDENTE→PROCESSANDO`);
   `externalReference=order.id` deduplica no emissor.
5. **Extrato (13.3):** badge por status; DANFE abre em nova aba; comanda em `ERRO` mostra o motivo e o botão
   "Tentar de novo" volta p/ `PENDENTE`; limite de tentativas barra com mensagem.
6. **Estorno (13.3.3, se incluído):** estornar comanda `EMITIDA` → tenta cancelar → `CANCELADA` (mock) sem
   travar o estorno.
7. **Segurança:** nenhum log/response vaza o token; `fiscalKeyEnc` cifrado no banco; operador sem `canSettings`
   não configura o emissor (403).

**PROD (após o merge):**
- Aplicar **`prisma/manual/2026-07-12-onda-h.sql`** inteiro no Supabase SQL Editor (idempotente — enums
  guardados, colunas `IF NOT EXISTS`) **antes** do deploy de código. **Não** duplicar com migration versionada
  ([[prod-schema-drift-destravar]]).
- Deploy web via Vercel CLI com token do time ([[vercel-hobby-push-block]]); `git pull` + restart do worker no
  Oracle ([[worker-oracle-update-procedure]]) — sobe **inerte** (`FISCAL_EMISSION` default false).
- Garantir **`ENCRYPTION_KEY`** presente no ambiente do web **e** do worker (o worker descriptografa o token na
  emissão). Sem ela, `saveFiscalCredential`/emissão falham cedo (por design).
- **Ligar gradual:** primeiro uma conta piloto em **HOMOLOGAÇÃO** (`fiscalEnv=HOMOLOGACAO`) com
  `FISCAL_EMISSION=true` no worker → validar o fluxo com o emissor real → só então trocar a conta para
  `PRODUCAO` e emitir nota real. Nunca ligar produção antes de um E2E de homologação com o emissor terceiro.

---

## Riscos e notas

- **Classificação tributária é o buraco real.** NFC-e exige NCM/CFOP/CSOSN corretos por item. v1 usa NCM/CFOP
  **padrão da conta** (ou a regra fiscal padrão do emissor p/ Simples Nacional) — funciona p/ varejo simples,
  mas **erra** em catálogos heterogêneos. O emissor rejeita (status `ERRO` com o motivo) — não emite nota
  errada silenciosamente. **`CatalogItem.ncm/cfop` por item é onda futura** (mesmo espírito do `ItemVariant`
  adiado na Onda G); o caminho está aberto (o `EmitNfceInput.items` já aceita `ncm/cfop` por linha).
- **Homologação × produção é crítico.** `fiscalEnv` **nunca** default produção; a UI avisa. Emitir em produção
  por engano gera nota real com valor fiscal/contábil — por isso o rollout começa em homologação.
- **Segredo do emissor.** `fiscalKeyEnc` cifrado (AES-256-GCM); **nunca** logar o token nem devolvê-lo na API
  (só `last4`). O worker precisa de `ENCRYPTION_KEY` p/ descriptografar — se faltar, falha cedo.
- **SEFAZ é lento e cai.** Por isso a emissão é assíncrona no worker (nunca no fechamento) e resiliente:
  `PENDENTE`→`PROCESSANDO`→re-consulta; falha de rede volta a `PENDENTE`; `ERRO` sai da fila (retry é manual,
  p/ não martelar com nota malformada). O caixa nunca trava esperando nota.
- **Nota em dobro.** Guardada por (a) flip atômico `updateMany where fiscalStatus=PENDENTE` (um só claim) e
  (b) `externalReference=order.id` (o emissor deduplica pela referência). As duas camadas cobrem corrida entre
  ticks/instâncias do worker.
- **Cancelamento tem janela legal curta (~30 min NFC-e).** O estorno pode vir depois — v1 faz best-effort
  (13.3.3) e, se a janela passou, deixa a nota `EMITIDA` com aviso (o contador resolve). Fila robusta de
  cancelamento é follow-up.
- **Cupom não-fiscal ≠ NFC-e.** A impressão da iniciativa 1 (recibo/comanda) **não** substitui a nota fiscal;
  são documentos distintos. O DANFE vem do emissor (`fiscalDanfeUrl`).
- **Opt-in não polui o resto.** `fiscalStatus` null p/ toda conta sem `fiscalEnabled` → os ~50 modelos de
  serviço/atendimento puro não veem nada de fiscal. `FISCAL_EMISSION` off por padrão → sobe inerte.
- **Testes sem SEFAZ.** O adaptador Focus NFe é testado com `fetch` mockado; o E2E usa `FISCAL_MOCK=true`
  (emissor determinístico). Nunca testar contra a SEFAZ real. Integração real = rollout em homologação (acima).
- **Onda H isolada.** Único arquivo `onda-h.sql`; nenhuma outra iniciativa compõe. Enums novos com guarda por
  exception (não `IF NOT EXISTS`, que não existe p/ `CREATE TYPE`). Nunca duplicar manual×migration
  ([[prod-schema-drift-destravar]]).

---

## Ordem de entrega recomendada
1. **13.1.1–13.1.4** (schema + emissor + credencial + config) — abre a Onda H; entregável e inerte (nada
   emite). Ship isolado.
2. **13.2.1–13.2.4** (carimbo + worker) — o coração; sobe inerte até `FISCAL_EMISSION`+opt-in. Valide com
   `FISCAL_MOCK` antes do emissor real.
3. **13.3.1–13.3.2** (extrato + retry) — dá visibilidade e recuperação ao operador.
4. **13.3.3** (cancelamento no estorno) — **opcional** no v1; pode virar manual pelo painel do emissor.
