# Funil de Vendas com Cobrança (Pix BYOK — Mercado Pago + Asaas) — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que a IA feche a venda dentro do WhatsApp — qualifica o lead, apresenta uma **oferta pré-cadastrada** (catálogo por número) e gera uma **cobrança Pix na conta do gateway do próprio cliente** (Mercado Pago ou Asaas). O pagamento é confirmado por **webhook**, movendo o lead para PAGO automaticamente. A plataforma **nunca toca no dinheiro** (modelo BYOK-de-pagamento).

**Architecture:** Espelha o BYOK de IA que já existe. Três blocos: (1) **credencial de pagamento** cifrada por conta (`paymentProvider` + `paymentKeyEnc`, igual a `aiProvider`/`aiKeyEnc`); (2) **catálogo de ofertas** — modelo `Offer` (structured: nome/preço/descrição) por número, cujo resumo é injetado no contexto da IA; a IA escolhe qual oferta apresentar (validado no servidor — o preço vem do banco, nunca da IA); (3) **camada de cobrança** — uma interface `PaymentGateway` com duas implementações (Mercado Pago, Asaas), um modelo `Sale` (uma cobrança por venda), uma rota de webhook por provider e um serviço `sales.service` idempotente. O gate de plano (`sales: boolean` em `PLAN_LIMITS`) e o gate de billing (conta suspensa → congela) reusam a régua existente.

**Tech Stack:** Next.js (App Router), TypeScript, Prisma + PostgreSQL, Zod, Vitest. HTTP nativo (`fetch`) para os gateways — sem SDK novo. Cifra via `src/server/crypto.ts` (AES-256-GCM) já existente.

---

## Contexto do código (já verificado — não re-descobrir)

- **BYOK de IA (padrão a espelhar):** `User` tem `aiProvider`, `aiKeyEnc` (cifrado `iv:tag:ciphertext`), `aiKeyLast4`, `aiKeyVerifiedAt` ([schema.prisma:90-94](../../prisma/schema.prisma)). O serviço [ai-credential.service.ts](../../src/server/services/ai-credential.service.ts) valida a chave (ping) antes de persistir cifrada; [resolve.ts:resolveProviderForUser](../../src/server/ai/resolve.ts) decide provider/chave. **Vamos replicar TUDO isso para pagamento.**
- **Cifra:** `encryptSecret`/`decryptSecret` em [crypto.ts](../../src/server/crypto.ts). `isEncryptionConfigured` em `lib/env.ts`.
- **Config por número:** `WhatsAppNumber` tem `persona`, `knowledgeBase`, `systemPromptOverride`, `aiModel`, `qualifyEnabled`, `scheduleEnabled` ([schema.prisma:406-421](../../prisma/schema.prisma)). A **oferta NÃO vira campo de texto aqui** — é modelo próprio `Offer` ligado ao número; um resumo é injetado no prompt.
- **Pipeline (state machine pura):** [pipeline.ts](../../src/server/services/pipeline.ts) `decidePipeline({current, score, nextAction})`. Estados em `enum LeadStatus` ([schema.prisma:134-141](../../prisma/schema.prisma)): NOVO, CONTATADO, EM_CONVERSA, QUALIFICADO, REUNIAO_AGENDADA, DESCARTADO. **Vamos adicionar OFERTA_ENVIADA e PAGO.**
- **Ação da IA:** `NEXT_ACTIONS = ["ask_question","schedule_meeting","discard"]` em [schemas.ts:10-14](../../src/server/ai/schemas.ts). **Vamos adicionar `send_offer`** + campo opcional `offerId`.
- **Fluxo de atendimento:** [conversation.service.ts:respondToLead](../../src/server/services/conversation.service.ts) carrega `company` (número), roda `qualifyLead` → `decidePipeline` → agenda/responde. É aqui que enganchamos a venda (após qualificação, se `shouldOffer`).
- **Gate de plano:** [plans.ts](../../src/lib/plans.ts) `PLAN_LIMITS` com flags booleanas (`qualify`/`schedule`/`campaigns`) + [entitlements.ts:assertFeature](../../src/server/services/entitlements.ts). Admin/grandfather isentos.
- **Gate de billing:** conta suspensa congela outbound (ver memória `financeiro-billing-gate`). A venda deve respeitar o mesmo estado.
- **Envio de WhatsApp:** `sendWhatsAppMessage(lead, texto)` em [messaging.ts](../../src/server/services/messaging.ts).
- **Payment model existente** ([schema.prisma:116](../../prisma/schema.prisma)) é o **billing do SaaS** (receita da plataforma) — NÃO confundir com `Sale` (venda do cliente ao lead dele). São coisas diferentes.

---

## Decisões já tomadas (não reabrir)

- **Dois gateways desde o MVP:** `MERCADO_PAGO` e `ASAAS`. Interface comum `PaymentGateway`; cada um numa implementação isolada. Provider escolhido por conta.
- **Catálogo (não 1 oferta):** modelo `Offer` (várias por número). A IA escolhe qual apresentar retornando `offerId`; o servidor **valida** que o id pertence às ofertas ativas do número. Se houver 1 só ativa, default nela; se ambíguo e a IA não escolheu, a IA pede esclarecimento (não cobra às cegas).
- **Integridade de preço:** o valor da cobrança vem SEMPRE de `Offer.priceCents` (banco). A IA nunca informa preço na cobrança — só apresenta o texto.
- **BYOK de pagamento:** a cobrança é criada na conta do gateway do CLIENTE (token dele, cifrado). A plataforma não intermedia o dinheiro. MVP: cliente cola o token (Access Token do MP / API Key do Asaas). OAuth Connect fica pra v2.
- **Confirmação segura:** o webhook é só um "ping". Ao recebê-lo, o serviço **re-consulta o status na API do gateway** com o token do cliente (fonte de verdade) — não confia no corpo do webhook. Idempotente (webhook repete).
- **Pix only no MVP.** Cartão/boleto depois. Sem reembolso/nota fiscal no MVP (responsabilidade do cliente, no gateway dele).
- **Gate:** feature `sales` só em planos que permitem (PROFISSIONAL/ESCALA). Conta suspensa → não gera cobrança.
- **A IA não "fecha" sozinha:** ela manda o Pix; o "vendido" é o webhook confirmando o pagamento.

---

## Task 0: Schema — enum, credencial de pagamento, Offer, Sale, status

**Files:**
- Modify: `prisma/schema.prisma`
- Command: `npx prisma migrate dev --name funil-vendas-pagamento`

**Step 1: Adicionar enum de provider e status de venda**

Em `prisma/schema.prisma`, junto aos outros enums:
```prisma
enum PaymentProvider {
  MERCADO_PAGO
  ASAAS
}

enum SaleStatus {
  PENDING   // cobrança criada, aguardando pagamento
  PAID      // confirmado via webhook + reconsulta na API
  EXPIRED   // Pix expirou sem pagamento
  CANCELED  // cancelado manualmente
}
```

**Step 2: Estender `enum LeadStatus`**
```prisma
enum LeadStatus {
  NOVO
  CONTATADO
  EM_CONVERSA
  QUALIFICADO
  REUNIAO_AGENDADA
  OFERTA_ENVIADA   // oferta apresentada + Pix enviado, aguardando pagamento
  PAGO             // pagamento confirmado
  DESCARTADO
}
```

**Step 3: Credencial de pagamento no `User`** (espelha o bloco BYOK de IA)
```prisma
  // BYOK de pagamento: credencial do gateway do cliente (null = vendas desligadas).
  paymentProvider   PaymentProvider? // MERCADO_PAGO | ASAAS | null
  paymentKeyEnc     String?          // token cifrado (AES-256-GCM): "iv:tag:ciphertext"
  paymentKeyLast4   String?          // 4 últimos p/ exibir na UI
  paymentKeyVerifiedAt DateTime?     // última validação bem-sucedida contra o gateway

  offers   Offer[]
  sales    Sale[]
```

**Step 4: Modelo `Offer` (catálogo por número)**
```prisma
// Oferta que a IA pode apresentar/cobrar. Ligada a um número; várias por número.
model Offer {
  id               String   @id @default(cuid())
  userId           String   // dono (tenant) — desnormalizado p/ query/isolamento
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  whatsAppNumberId String
  whatsAppNumber   WhatsAppNumber @relation(fields: [whatsAppNumberId], references: [id], onDelete: Cascade)
  name             String   // "Mentoria Fitness"
  description      String?  // "Plano de treino + acompanhamento semanal"
  priceCents       Int      // valor em centavos (BRL) — FONTE DE VERDADE do preço
  active           Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  sales            Sale[]

  @@index([whatsAppNumberId, active])
}
```

**Step 5: Modelo `Sale` (uma cobrança por venda)**
```prisma
// Uma cobrança gerada p/ um lead. Fonte de verdade do estado da venda.
model Sale {
  id               String          @id @default(cuid())
  userId           String
  user             User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  leadId           String
  lead             Lead            @relation(fields: [leadId], references: [id], onDelete: Cascade)
  offerId          String
  offer            Offer           @relation(fields: [offerId], references: [id])
  provider         PaymentProvider
  providerChargeId String          // id da cobrança no gateway (chave de reconciliação)
  amountCents      Int             // snapshot do priceCents no momento da cobrança
  status           SaleStatus      @default(PENDING)
  pixCopiaECola    String?         // payload Pix copia-e-cola
  createdAt        DateTime        @default(now())
  paidAt           DateTime?

  @@unique([provider, providerChargeId]) // idempotência do webhook
  @@index([leadId])
}
```
> Em `Lead` e `WhatsAppNumber`, adicione os lados inversos: `sales Sale[]` no `Lead`; `offers Offer[]` no `WhatsAppNumber`.

**Step 6: Migração**

Run: `npx prisma migrate dev --name funil-vendas-pagamento`
Expected: migração criada + `prisma generate` roda; tipos novos disponíveis (`PaymentProvider`, `SaleStatus`, `Offer`, `Sale`).

**Step 7: Commit**
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(vendas): schema — credencial de pagamento, Offer, Sale, novos status"
```

---

## Task 1: `sales` no gate de plano

**Files:**
- Modify: `src/lib/plans.ts`, `src/lib/plans.test.ts`

**Step 1: Teste que falha**
```ts
  it("só PROFISSIONAL e ESCALA liberam vendas (funil de pagamento)", () => {
    expect(PLAN_LIMITS.INICIAL.sales).toBe(false);
    expect(PLAN_LIMITS.PROFISSIONAL.sales).toBe(true);
    expect(PLAN_LIMITS.ESCALA.sales).toBe(true);
  });
```

**Step 2: Rodar e ver falhar** — `npx vitest run src/lib/plans.test.ts` → FAIL (`sales` undefined).

**Step 3: Implementar** — em `PlanLimits` adicione `sales: boolean;` e nos três planos: INICIAL `false`, PROFISSIONAL `true`, ESCALA `true`.

**Step 4: Rodar e ver passar.**

**Step 5: Commit**
```bash
git commit -am "feat(vendas): flag sales por plano"
```

---

## Task 2: Credencial de pagamento (BYOK) — resolução + persistência cifrada

**Files:**
- Create: `src/server/services/payment-credential.service.ts`
- Create: `src/server/services/payment-credential.service.test.ts`
- Create: `src/server/payments/resolve.ts` (resolve provider+token do usuário)

**Step 1: Teste do resolver** (`payment-credential.service.test.ts`) — mocka `prisma` e `crypto`:
```ts
describe("resolvePaymentForUser", () => {
  it("devolve provider + token decifrado quando configurado", async () => {
    const { prisma } = await import("@/server/db/client");
    const { encryptSecret } = await import("@/server/crypto");
    (prisma.user.findUnique as any).mockResolvedValue({
      paymentProvider: "ASAAS", paymentKeyEnc: encryptSecret("tok_123456789"),
    });
    const { resolvePaymentForUser } = await import("@/server/payments/resolve");
    const r = await resolvePaymentForUser("u1");
    expect(r).toEqual({ provider: "ASAAS", apiKey: "tok_123456789" });
  });
  it("devolve null quando não configurado (vendas desligadas)", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ paymentProvider: null, paymentKeyEnc: null });
    const { resolvePaymentForUser } = await import("@/server/payments/resolve");
    expect(await resolvePaymentForUser("u1")).toBeNull();
  });
});
```

**Step 2: Rodar e ver falhar.**

**Step 3: Implementar `resolve.ts`**
```ts
import { prisma } from "@/server/db/client";
import { decryptSecret } from "@/server/crypto";
import type { PaymentProvider } from "@prisma/client";

export interface ResolvedPayment { provider: PaymentProvider; apiKey: string; }

/** Credencial de pagamento do dono (null = cliente não configurou → vendas off). */
export async function resolvePaymentForUser(userId: string): Promise<ResolvedPayment | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { paymentProvider: true, paymentKeyEnc: true },
  });
  if (!u?.paymentProvider || !u.paymentKeyEnc) return null;
  return { provider: u.paymentProvider, apiKey: decryptSecret(u.paymentKeyEnc) };
}
```

**Step 4: Implementar `payment-credential.service.ts`** (espelha `ai-credential.service.ts`): `getPaymentCredentialStatus`, `savePaymentCredential` (valida token contra o gateway — ver Task 3 `verifyCredential` — depois persiste cifrado com `encryptSecret`, `paymentKeyLast4`, `paymentKeyVerifiedAt`), `removePaymentCredential`. Gate: exige `assertFeature(userId, "sales")` (Task 5) antes de salvar.

**Step 5: Rodar e ver passar.**

**Step 6: Commit**
```bash
git commit -am "feat(vendas): credencial de pagamento BYOK (cifrada) + resolver"
```

---

## Task 3: Camada de gateway — interface + Asaas + Mercado Pago

**Files:**
- Create: `src/server/payments/gateway.ts` (interface + factory)
- Create: `src/server/payments/asaas.ts`
- Create: `src/server/payments/mercadopago.ts`
- Create: `src/server/payments/gateway.test.ts`

**Step 1: Definir a interface** (`gateway.ts`)
```ts
import type { PaymentProvider } from "@prisma/client";

export interface CreatePixChargeInput {
  apiKey: string;
  amountCents: number;
  description: string;
  externalReference: string; // = Sale.id, p/ reconciliar
  payerName?: string;
}
export interface PixCharge {
  providerChargeId: string;
  pixCopiaECola: string;
  pixQrCodeBase64?: string;
}
export interface PaymentGateway {
  /** Cria a cobrança Pix na conta do cliente. */
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
  /** Consulta status atual (fonte de verdade). Retorna true se PAGO. */
  isChargePaid(apiKey: string, providerChargeId: string): Promise<boolean>;
  /** Valida a credencial (chamada barata) — usado ao salvar o token. */
  verifyCredential(apiKey: string): Promise<boolean>;
  /** Extrai o providerChargeId do corpo do webhook (sem confiar em status). */
  parseWebhookChargeId(body: unknown): string | null;
}

export function gatewayFor(provider: PaymentProvider): PaymentGateway {
  return provider === "ASAAS" ? asaasGateway : mercadoPagoGateway;
}
```

**Step 2: Teste (HTTP mockado)** — cada gateway com `global.fetch` mockado; assert que `createPixCharge` monta a request certa (URL, header de auth, body) e mapeia a resposta; `isChargePaid` lê o status; `parseWebhookChargeId` extrai o id dos formatos reais de webhook (MP: `{type:"payment", data:{id}}`; Asaas: `{event:"PAYMENT_RECEIVED", payment:{id}}`).

**Step 3: Implementar `asaas.ts`** — REST com header `access_token: <apiKey>`. Base sandbox/prod por `env.ASAAS_BASE_URL`. Fluxo: `POST /v3/payments` (billingType PIX, value = amountCents/100, externalReference) → pega `id` → `GET /v3/payments/{id}/pixQrCode` (copia-e-cola + QR base64). `isChargePaid`: `GET /v3/payments/{id}` → status `RECEIVED`/`CONFIRMED`. `verifyCredential`: `GET /v3/myAccount` (200 = ok). `parseWebhookChargeId`: `body.payment?.id`.
> Docs: cobranças via Pix e webhook em https://docs.asaas.com/docs/cobrancas-via-pix e https://docs.asaas.com/docs/webhook-para-cobrancas

**Step 4: Implementar `mercadopago.ts`** — REST com header `Authorization: Bearer <apiKey>`. `POST /v1/payments` (payment_method_id `pix`, transaction_amount, external_reference, `notification_url`) → resposta traz `id` e `point_of_interaction.transaction_data.qr_code` (copia-e-cola) + `qr_code_base64`. `isChargePaid`: `GET /v1/payments/{id}` → `status === "approved"`. `verifyCredential`: `GET /v1/payment_methods` (200 = token válido). `parseWebhookChargeId`: `body.data?.id` (topic `payment`).
> Docs: Pix em https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix e webhooks em https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks

**Step 5: Rodar e ver passar.**

**Step 6: Env** — adicione em `.env.example`/`lib/env.ts`: `ASAAS_BASE_URL` (default sandbox), `MERCADOPAGO_BASE_URL` (default `https://api.mercadopago.com`), `APP_PUBLIC_URL` (p/ montar `notification_url`).

**Step 7: Commit**
```bash
git commit -am "feat(vendas): gateway Pix (interface + Asaas + Mercado Pago)"
```

---

## Task 4: Catálogo de ofertas — `offer.service`

**Files:**
- Create: `src/server/services/offer.service.ts`, `offer.service.test.ts`

**Step 1: Testes** — CRUD tenant-scoped + gate:
- `createOffer` exige `assertFeature(userId, "sales")`; grava `priceCents`, `active`.
- `listOffers(numberId)` só do dono; `updateOffer`/`deleteOffer` validam que a oferta é do `userId`.
- `listActiveOffers(numberId)` filtra `active: true` (usado no runtime).

**Step 2: Rodar e ver falhar.**

**Step 3: Implementar** — funções puras de serviço sobre `prisma.offer`, sempre filtrando por `userId` (isolamento), `assertFeature` no create/update. Preço recebido em centavos; validar `priceCents >= 100` (mínimo R$1,00) e `name` não-vazio com Zod.

**Step 4: Rodar e ver passar.**

**Step 5: Commit**
```bash
git commit -am "feat(vendas): catalogo de ofertas por numero (CRUD + gate)"
```

---

## Task 5: IA — `send_offer` + `offerId` + ofertas no contexto

**Files:**
- Modify: `src/server/ai/schemas.ts`, `src/server/ai/schemas.test.ts`
- Modify: `src/server/ai/qualification.agent.ts` (prompt + schema de saída)
- Modify: `src/server/ai/attendance-context.ts` (injeta ofertas ativas)

**Step 1: Testes de schema** — `NEXT_ACTIONS` inclui `send_offer`; a saída da qualificação aceita `offerId: string | null` opcional.

**Step 2: Implementar schema**
```ts
export const NEXT_ACTIONS = ["ask_question", "schedule_meeting", "send_offer", "discard"] as const;
```
No schema de qualificação, adicione `offerId: z.string().nullable().optional()` e no prompt: instruir que, quando o lead demonstra intenção clara de compra, retorne `nextAction: "send_offer"` e **escolha `offerId` entre as ofertas listadas** (nunca invente id/preço); se houver mais de uma e o lead não deixou claro qual, use `ask_question` pedindo esclarecimento.

**Step 3: Injetar ofertas no contexto** — em `attendance-context.ts` (ou onde o system prompt é montado), renderize as ofertas ativas do número como bloco estruturado:
```
OFERTAS DISPONÍVEIS (use o id ao escolher; o preço é fixo, não altere):
- id=off_abc | Mentoria Fitness | R$197,00 | Plano de treino + acompanhamento semanal
- id=off_def | Consultoria Avulsa | R$97,00 | Sessão única de 1h
```
Passe as ofertas ativas (Task 4 `listActiveOffers`) pra função de contexto.

**Step 4: Rodar testes (schemas + evals pulados sem RUN_AI_EVALS).**

**Step 5: Commit**
```bash
git commit -am "feat(vendas): IA conhece ofertas e pode acionar send_offer"
```

---

## Task 6: Pipeline — decidir `shouldOffer`

**Files:**
- Modify: `src/server/services/pipeline.ts`, `pipeline.test.ts`

**Step 1: Testes**
```ts
it("send_offer com offerId → shouldOffer true, status OFERTA_ENVIADA", () => {
  const d = decidePipeline({ current: "EM_CONVERSA", score: 80, nextAction: "send_offer" });
  expect(d.shouldOffer).toBe(true);
  expect(d.status).toBe("OFERTA_ENVIADA");
});
it("estados terminais (PAGO/DESCARTADO) não reagem", () => {
  expect(decidePipeline({ current: "PAGO", score: 90, nextAction: "send_offer" }).shouldOffer).toBe(false);
});
```

**Step 2: Rodar e ver falhar.**

**Step 3: Implementar** — adicione `shouldOffer: boolean` a `PipelineDecision`; inclua `PAGO` em `TERMINAL`; novo ramo: `nextAction === "send_offer"` → `{ status: "OFERTA_ENVIADA", shouldOffer: true, shouldSchedule: false, shouldReply: false, shouldDiscard: false }`. Todos os outros retornos ganham `shouldOffer: false`.

**Step 4: Rodar e ver passar.**

**Step 5: Commit**
```bash
git commit -am "feat(vendas): pipeline decide shouldOffer (OFERTA_ENVIADA)"
```

---

## Task 7: `sales.service` — enviar oferta e confirmar pagamento (idempotente)

**Files:**
- Create: `src/server/services/sales.service.ts`, `sales.service.test.ts`

**Step 1: Testes**
- `sendOffer(lead, offerId)`:
  - resolve credencial (`resolvePaymentForUser`); se null → não cobra, loga e retorna `{ sent:false, reason:"no_gateway" }`.
  - valida oferta ativa e do dono; snapshot `amountCents = offer.priceCents`.
  - conta suspensa (billing gate) → `{ sent:false, reason:"suspended" }` (sem cobrar).
  - cria `Sale` PENDING, chama `gateway.createPixCharge`, salva `providerChargeId`/`pixCopiaECola`, envia o copia-e-cola via `sendWhatsAppMessage`, seta `lead.status = OFERTA_ENVIADA`.
- `confirmPaymentByCharge(provider, providerChargeId)`:
  - acha `Sale` por `@@unique([provider, providerChargeId])`; se não achar → no-op.
  - **idempotente:** se já `PAID` → retorna sem reprocessar.
  - **reconsulta na API** (`gateway.isChargePaid`) com o token do dono; só marca PAID se a API confirmar (não confia no webhook).
  - marca `Sale.status=PAID`, `paidAt`, `lead.status=PAGO`, envia mensagem pós-venda.

**Step 2: Rodar e ver falhar.**

**Step 3: Implementar** — usar `gatewayFor(provider)`, `resolvePaymentForUser`, checagem de suspensão (reusar o helper de billing existente), transações Prisma onde fizer sentido. Preço SEMPRE de `offer.priceCents`.

**Step 4: Rodar e ver passar.**

**Step 5: Commit**
```bash
git commit -am "feat(vendas): sales.service — envia Pix e confirma pagamento (idempotente)"
```

---

## Task 8: Enganchar no `respondToLead`

**Files:**
- Modify: `src/server/services/conversation.service.ts`

**Step 1:** após a qualificação (onde hoje trata `shouldSchedule`/`shouldDiscard`), antes da resposta livre:
```ts
if (mode.qualify && decision.shouldOffer && salesEnabled) {
  const offerId = qual.offerId ?? (activeOffers.length === 1 ? activeOffers[0].id : null);
  if (offerId) {
    const r = await sendOffer(lead, offerId);
    if (r.sent) return; // Pix enviado; encerra o turno
  }
  // sem offerId resolvível → cai na resposta livre (a IA pede esclarecimento)
}
```
- `salesEnabled` = `company` do número tem vendas ligadas + `assertFeature`/plan permite + existe credencial. Carregue `activeOffers` (Task 4) junto do `company`.
- Reuse o clamp/crédito de IA já existente para as chamadas do turno.

**Step 2: Type-check + suíte** — `npx tsc --noEmit && npx vitest run`.

**Step 3: Commit**
```bash
git commit -am "feat(vendas): respondToLead dispara oferta quando a IA decide vender"
```

---

## Task 9: Webhook por provider

**Files:**
- Create: `src/app/api/webhooks/payment/[provider]/route.ts`
- Create: teste de rota (segue o padrão de `src/app/api/numbers/route.test.ts`)

**Step 1: Teste** — POST com corpo de webhook MP/Asaas → extrai chargeId, chama `confirmPaymentByCharge`, responde 200. Corpo inválido → 200 (não vazar erro ao gateway) mas sem efeito. Idempotência: segundo POST não reprocessa.

**Step 2: Implementar**
```ts
export async function POST(req: Request, { params }: { params: { provider: string } }) {
  const provider = params.provider.toUpperCase() === "ASAAS" ? "ASAAS" : "MERCADO_PAGO";
  const body = await req.json().catch(() => null);
  const chargeId = gatewayFor(provider).parseWebhookChargeId(body);
  if (chargeId) await confirmPaymentByCharge(provider, chargeId); // reconsulta na API lá dentro
  return NextResponse.json({ ok: true }); // sempre 200 (o gateway não deve re-tentar por erro nosso)
}
```
> Segurança: a confiança está na **reconsulta via API** (Task 7), não no corpo. Opcional (follow-up): validar assinatura MP (`x-signature`) e um token de webhook do Asaas.

**Step 3: Type-check + rodar.**

**Step 4: Commit**
```bash
git commit -am "feat(vendas): rota de webhook de pagamento por provider"
```

---

## Task 10: UI — conectar gateway (credencial)

**Files:**
- Modify: `src/components/app/AccountSettings.tsx`
- Modify: `src/app/(app)/configuracoes/page.tsx`
- Create: `src/app/api/account/payment-key/route.ts` (POST salva, DELETE remove — espelha `account/ai-key`)

**Step 1:** bloco "Receber pagamentos (Pix)" nas configurações: seletor de provider (Mercado Pago / Asaas), campo de token, botão "Conectar" (valida via `savePaymentCredential`), status "Conectado •••• 1234", botão remover. Gate: só aparece/habilita se o plano tem `sales`.

**Step 2: Type-check + validar visual** (`npm run dev`).

**Step 3: Commit**
```bash
git commit -am "feat(vendas): UI para conectar gateway de pagamento"
```

---

## Task 11: UI — catálogo de ofertas por número

**Files:**
- Modify: `src/components/WhatsAppNumbersPanel.tsx`
- Create: `src/app/api/numbers/[id]/offers/route.ts` (+ `[offerId]` p/ update/delete)

**Step 1:** dentro da config do número, seção "Ofertas": lista, adicionar (nome, preço em R$, descrição), editar, ativar/desativar. Toggle "Modo vendas" (liga a IA a acionar `send_offer`). Aviso quando não há gateway conectado ("Conecte um gateway em Configurações para cobrar"). Gate por `sales`.

**Step 2: Type-check + validar visual.**

**Step 3: Commit**
```bash
git commit -am "feat(vendas): UI de catalogo de ofertas por numero"
```

---

## Task 12: UI — pipeline e detalhe do lead

**Files:**
- Modify: `src/components/LeadsDashboard.tsx` (colunas OFERTA_ENVIADA, PAGO)
- Modify: `src/components/LeadDetailView.tsx` (status da venda: valor, oferta, status, link Pix)

**Step 1:** adicionar as duas colunas ao board; no detalhe do lead, mostrar a `Sale` mais recente (oferta, valor, status, copia-e-cola se PENDING). Rótulos PT-BR no `pipelineLabels` default.

**Step 2: Type-check + validar visual.**

**Step 3: Commit**
```bash
git commit -am "feat(vendas): pipeline mostra OFERTA_ENVIADA/PAGO e detalhe da venda"
```

---

## Task 13: Verificação end-to-end (sandbox)

**Step 1: Suíte + build** — `npx vitest run && npx tsc --noEmit && npm run build`.

**Step 2: Sandbox manual** (Asaas sandbox + MP test user):
1. Plano PRO → conectar gateway (token sandbox) → status "Conectado".
2. Criar 2 ofertas ativas no número; ligar "Modo vendas".
3. Simular conversa até intenção de compra → IA escolhe `send_offer` + `offerId` → lead vira OFERTA_ENVIADA e recebe o copia-e-cola.
4. Pagar no sandbox → webhook chega → reconsulta confirma → lead vira PAGO + mensagem pós-venda. Repetir o webhook (idempotência: nada muda).
5. Conta INICIAL → seção de vendas escondida; `sendOffer` não dispara.
6. Conta suspensa → cobrança não é gerada.
7. Sem gateway conectado → IA não manda Pix (cai na resposta livre).

**Step 3: Commit final**
```bash
git commit -am "test(vendas): verificacao e2e do funil de vendas (sandbox)"
```

---

## Notas / follow-ups (fora do MVP)

- **Assinatura de webhook** (MP `x-signature`, token Asaas): a segurança do MVP está na reconsulta via API; adicionar verificação de assinatura como defesa extra.
- **OAuth Connect (MP)** em vez de colar token — melhor UX, evita token exposto.
- **Cartão/boleto**, **reembolso**, **nota fiscal**, **expiração/lembrete de Pix não pago** (worker que reenvia ou expira `Sale`).
- **Comissão da plataforma** via PIX Split do MP (monetização futura).
- **Métricas de venda** no dashboard financeiro (conversão oferta→pago, ticket médio) — separado do billing do SaaS.
- **PROPOSED + venda**: hoje agendamento e venda são ramos distintos; alinhar se um número puder agendar E vender.
