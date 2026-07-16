# Gateway PagBank (Pix) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar o **PagBank (PagSeguro)** como terceiro gateway de pagamento Pix da plataforma, para o dono da conta cobrar (via `enviar_oferta` e futuras cobranças) usando o próprio token PagBank — no mesmo modelo BYOK cifrado que Mercado Pago e Asaas já usam.

**Architecture:** Toda a maquinaria de cobrança já é **provider-agnóstica**: existe a interface `PaymentGateway` (`createPixCharge`/`isChargePaid`/`verifyCredential`/`parseWebhookChargeId`), o token cifrado por conta (`User.paymentKeyEnc`), o dispatcher `gatewayFor(provider)`, o webhook `/api/webhooks/payment/[provider]` e a reconciliação por reconsulta. Adicionar o PagBank é: (1) um valor novo no enum `PaymentProvider`; (2) um arquivo `pagbank.ts` implementando a interface; (3) plugar esse arquivo no `gatewayFor` e no mapeamento do webhook; (4) liberar o provider na rota de credencial e na UI. **Nada** de comanda/IA/oferta muda. **InfinitePay ficou FORA de escopo** (decisão do dono 2026-07-07): a API pública dela é um modelo de *link de checkout* (devolve URL, não copia-e-cola) e não encaixa na interface atual — vira iniciativa separada.

**Tech Stack:** Next.js App Router (route handlers), Prisma + Postgres (Supabase), Zod, Vitest. Gateway PagBank via REST (`POST /orders` com QR Code Pix). Deploy PROD por **onda SQL manual idempotente** (`ALTER TYPE ... ADD VALUE`), nunca por migration versionada — ver `[[prod-schema-drift-destravar]]`.

**Docs de referência (PagBank):**
- Criar pedido com QR Code (PIX): https://developer.pagbank.com.br/reference/criar-pedido-pedido-com-qr-code
- Objeto Order / webhooks: https://developer.pagbank.com.br/reference/objeto-order · https://developer.pagbank.com.br/reference/webhooks
- Consultar pedido: https://developer.pagbank.com.br/reference/consultar-pedido-parametros

---

## Convenções desta base (leia antes de começar)

- **Testes:** `npm test` (→ `vitest run`). Co-localizados: `foo.ts` → `foo.test.ts` ao lado. Os testes de gateway **não tocam DB/rede** — mockam `fetch` com `vi.stubGlobal` (ver `src/server/payments/gateway.test.ts`, o padrão a seguir).
- **Multi-tenant:** credencial de pagamento é do **DONO** (`ctx.tenantUserId`); mutações exigem `ctx.perms.canFinance` (403 se faltar).
- **BYOK cifrado:** o token entra por `savePaymentCredential(userId, provider, apiKey)` → validado por `verifyCredential` → cifrado em `User.paymentKeyEnc` (só `last4` em claro). Resolvido no runtime por `resolvePaymentForUser`. Precisa de `ENCRYPTION_KEY` na plataforma.
- **Gateway = fonte de verdade:** o webhook é só um "ping"; `confirmPaymentByCharge` **reconsulta** o status na API do gateway com o token do dono (corpo forjado é inofensivo). Não confiar no corpo do webhook para marcar pago.
- **Deploy PROD:** editar `prisma/schema.prisma`, `npm run db:push` no dev, e criar **UMA** onda SQL idempotente (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`). Não criar pasta em `prisma/migrations/`. Antes de `db:push` no Windows, parar o `next dev` (`[[prisma-generate-dev-server-lock]]`).
- **Commits frequentes.** Um commit por task (test + código juntos). Rodapé de commit conforme instrução da sessão.

---

## Sumário das fases

| Fase | Entrega | Schema? |
|---|---|---|
| 0 | Spike sandbox: validar as suposições da API PagBank (corpo mínimo, verifyCredential, webhook) | não |
| 1 | Schema: `PaymentProvider.PAGBANK` + onda SQL | **Sim** |
| 2 | `env.PAGBANK_BASE_URL` | não |
| 3 | `pagbank.ts` (gateway) + teste TDD | não |
| 4 | `gatewayFor` roteia PAGBANK + teste | não |
| 5 | Webhook `[provider]` mapeia PAGBANK + teste | não |
| 6 | Rota de credencial aceita PAGBANK | não |
| 7 | UI (AccountSettings): opção + label + placeholder | não |
| 8 | Gate verde + checklist de deploy + memória | — |

---

# FASE 0 — Spike de sandbox (reduz o risco de API externa)

> **Por que primeiro:** três suposições dependem da API real do PagBank e não dá pra "adivinhar" com segurança: (a) o **corpo mínimo** aceito pelo `POST /orders` com QR Pix (o `customer` é obrigatório?); (b) qual endpoint barato serve de `verifyCredential`; (c) o formato do **corpo do webhook** (o id no root é o `ORDE_...`?). Esta fase valida isso contra o **sandbox** e ajusta as tasks seguintes se algo divergir. Não gera commit de código.

### Task 0.1: Obter token de sandbox e validar o fluxo com curl

**Passos (manuais, documentar o resultado neste arquivo):**

1. Criar conta/entrar no **Sandbox PagBank** → menu "Perfis de Integração" → "Vendedor" → copiar o token em "Credenciais". Cadastrar ao menos **1 chave Pix** na conta sandbox (exigência para gerar QR).
2. **Criar pedido Pix** (base sandbox = `https://sandbox.api.pagseguro.com`):
   ```bash
   curl -s -X POST https://sandbox.api.pagseguro.com/orders \
     -H "Authorization: Bearer $PAGBANK_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "reference_id": "sale_spike_1",
       "qr_codes": [{ "amount": { "value": 500 } }],
       "notification_urls": ["https://app.test/api/webhooks/payment/pagbank"]
     }'
   ```
   **Confirmar na resposta:** existe `id` no root (`ORDE_...`)? `qr_codes[0].text` traz o copia-e-cola? `qr_codes[0].links[]` tem um item `media: "image/png"`? O `value` é mesmo em **centavos** (500 = R$ 5,00)?
   - **Se o PagBank recusar sem `customer`:** anotar o mínimo exigido (ex.: `customer.name` + `customer.tax_id` + `customer.email`) e ajustar o corpo na Task 3.3 (passar `payerName`/placeholders).
3. **Consultar o pedido** (vira o `isChargePaid`):
   ```bash
   curl -s https://sandbox.api.pagseguro.com/orders/ORDE_XXXX \
     -H "Authorization: Bearer $PAGBANK_TOKEN"
   ```
   **Confirmar:** onde aparece o status pago — `charges[].status === "PAID"`? (Pix cria a `charge` só quando pago.)
4. **verifyCredential:** testar `GET /orders/?reference_id=__verify__` com token **válido** (espera 200/404) e com token **inválido** (espera 401/403). Anotar os status reais para a Task 3.3 usar `res.status !== 401 && res.status !== 403`.
5. (Opcional) Pagar o QR no app sandbox e capturar o **corpo do webhook** recebido — confirmar que o `id` no root é o `ORDE_...` (o mesmo que guardamos como `providerChargeId`).

**Saída da fase:** um bloco de notas (colar abaixo desta task no arquivo) com: unidade do valor (centavos ✔/�’), campos de resposta reais, status do `verifyCredential`, e shape do webhook. **Se tudo bater com as suposições deste plano, seguir sem mudanças.** Se divergir, ajustar as Tasks 3.3 (corpo/parse) antes de implementar.

> Sem acesso a sandbox agora? Seguir assim mesmo com as suposições documentadas (centavos, `qr_codes[0].text`, webhook com `id` no root), mas **marcar a Task 8.2** para um smoke real em staging antes de PROD.

---

# FASE 1 — Schema

### Task 1.1: Adicionar `PAGBANK` ao enum `PaymentProvider`

**Files:**
- Modify: `prisma/schema.prisma` (enum `PaymentProvider`, L22-25)

**Step 1 — Editar o enum:**
```prisma
enum PaymentProvider {
  MERCADO_PAGO
  ASAAS
  PAGBANK
}
```

**Step 2 — Aplicar no dev** (parar o `next dev` antes — Windows lock):
```bash
npm run db:push
```
Expected: `Your database is now in sync with your Prisma schema.` + client regenerado (o tipo `PaymentProvider` passa a incluir `PAGBANK`).

**Step 3 — NÃO commitar ainda** — o commit vem com a onda SQL na Task 1.2.

---

### Task 1.2: Onda SQL manual idempotente (PROD)

**Files:**
- Create: `prisma/manual/2026-07-14-onda-j.sql` (confirmar a próxima letra livre: listar `prisma/manual/` — a última é `onda-i`; usar `j`; ajustar a data/letra se necessário)

**Step 1 — Escrever o SQL:**
```sql
-- Onda J — Gateway PagBank (Pix). Idempotente. Aplicar no Supabase SQL Editor.
-- ADD VALUE IF NOT EXISTS roda fora de transação; rodar esta linha SOZINHA
-- (Postgres não deixa usar o valor novo do enum na mesma transação que o criou).
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'PAGBANK';
```

**Step 2 — Commit** (schema + onda juntos):
```bash
git add prisma/schema.prisma prisma/manual/2026-07-14-onda-j.sql
git commit -m "feat(payments): enum PaymentProvider ganha PAGBANK + onda-j SQL"
```

> **Nota de deploy:** aplicar no Supabase **antes** do deploy de código (senão salvar credencial PAGBANK dá erro de enum). É só 1 linha. Registrado na Fase 8.

---

# FASE 2 — Env

### Task 2.1: `PAGBANK_BASE_URL` no schema de env

**Files:**
- Modify: `src/lib/env.ts` (perto de `ASAAS_BASE_URL`/`MERCADOPAGO_BASE_URL`, ~L121-122)

**Step 1 — Adicionar a var** (default = sandbox, igual o Asaas):
```ts
  PAGBANK_BASE_URL: z.string().default("https://sandbox.api.pagseguro.com"),
```
> PROD usa `https://api.pagseguro.com` — setar a env na Vercel/worker no deploy (Fase 8). O default sandbox evita cobrar de verdade em dev.

**Step 2 — Commit:**
```bash
git add src/lib/env.ts
git commit -m "feat(payments): env PAGBANK_BASE_URL (default sandbox)"
```

---

# FASE 3 — Gateway PagBank

### Task 3.1: Escrever o teste que falha (`pagbank.test.ts`)

**Files:**
- Create: `src/server/payments/pagbank.test.ts`
- (Referência de padrão: os `describe("asaasGateway"/"mercadoPagoGateway")` em `src/server/payments/gateway.test.ts` — mesmo mock de `fetch`)

**Step 1 — Escrever o teste** (mesmo boilerplate de mock do `gateway.test.ts`):
```ts
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

beforeAll(() => {
  process.env.PAGBANK_BASE_URL = "https://pagbank.test";
  process.env.APP_PUBLIC_URL = "https://app.test";
});

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("pagBankGateway", () => {
  it("createPixCharge manda valor em CENTAVOS e extrai o copia-e-cola", async () => {
    const { pagBankGateway } = await import("./pagbank");
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        id: "ORDE_ABC",
        qr_codes: [
          {
            id: "QRCO_1",
            text: "000201PAGBANK",
            links: [
              { media: "image/png", href: "https://pagbank.test/qr.png" },
              { media: "text/plain", href: "https://pagbank.test/qr.txt" },
            ],
          },
        ],
      }),
    );

    const charge = await pagBankGateway.createPixCharge({
      apiKey: "tok_pb",
      amountCents: 5700,
      description: "Comanda #12",
      externalReference: "sale_9",
      payerName: "João",
    });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://pagbank.test/orders");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok_pb");
    const sent = JSON.parse(opts.body);
    // PagBank usa CENTAVOS (inteiro) — NÃO dividir por 100.
    expect(sent.qr_codes[0].amount.value).toBe(5700);
    expect(sent.reference_id).toBe("sale_9");
    expect(sent.notification_urls[0]).toBe("https://app.test/api/webhooks/payment/pagbank");

    expect(charge.providerChargeId).toBe("ORDE_ABC"); // guardamos o id do PEDIDO
    expect(charge.pixCopiaECola).toBe("000201PAGBANK");
  });

  it("isChargePaid = true quando alguma charge está PAID", async () => {
    const { pagBankGateway } = await import("./pagbank");
    fetchMock.mockResolvedValueOnce(jsonRes({ charges: [{ status: "PAID" }] }));
    expect(await pagBankGateway.isChargePaid("tok", "ORDE_ABC")).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonRes({ charges: [{ status: "WAITING" }] }));
    expect(await pagBankGateway.isChargePaid("tok", "ORDE_ABC")).toBe(false);
    fetchMock.mockResolvedValueOnce(jsonRes({})); // sem charges ainda
    expect(await pagBankGateway.isChargePaid("tok", "ORDE_ABC")).toBe(false);
  });

  it("verifyCredential: 401/403 = inválido; 200/404 = válido", async () => {
    const { pagBankGateway } = await import("./pagbank");
    fetchMock.mockResolvedValueOnce(jsonRes({}, false, 401));
    expect(await pagBankGateway.verifyCredential("tok")).toBe(false);
    fetchMock.mockResolvedValueOnce(jsonRes({}, true, 200));
    expect(await pagBankGateway.verifyCredential("tok")).toBe(true);
    fetchMock.mockResolvedValueOnce(jsonRes({}, false, 404));
    expect(await pagBankGateway.verifyCredential("tok")).toBe(true); // autenticado, só não achou
  });

  it("parseWebhookChargeId extrai o id do pedido (root)", async () => {
    const { pagBankGateway } = await import("./pagbank");
    expect(pagBankGateway.parseWebhookChargeId({ id: "ORDE_ABC", charges: [{ status: "PAID" }] })).toBe("ORDE_ABC");
    expect(pagBankGateway.parseWebhookChargeId({})).toBeNull();
  });
});
```

**Step 2 — Rodar e ver falhar:**
```bash
npx vitest run src/server/payments/pagbank.test.ts
```
Expected: FAIL (módulo `./pagbank` não existe).

---

### Task 3.2: Implementar `pagbank.ts`

**Files:**
- Create: `src/server/payments/pagbank.ts`
- (Referência: `src/server/payments/mercadopago.ts` — mesma estrutura de `base()`/`headers()`/`notificationUrl()`)

**Step 1 — Escrever a implementação:**
```ts
import { env } from "@/lib/env";
import type {
  CreatePixChargeInput,
  PaymentGateway,
  PixCharge,
} from "./gateway";

/**
 * Gateway PagBank (PagSeguro) — Pix via Orders API. Auth por header
 * `Authorization: Bearer <token>`. Base sandbox/prod via env.PAGBANK_BASE_URL.
 * ATENÇÃO: o PagBank usa o valor em CENTAVOS (inteiro), diferente de MP/Asaas
 * (reais decimal). Guardamos o id do PEDIDO (ORDE_...) como providerChargeId —
 * a charge Pix só nasce quando pago; o webhook e a reconsulta batem pelo pedido.
 *
 * Docs: https://developer.pagbank.com.br/reference/criar-pedido-pedido-com-qr-code
 */
function base(): string {
  return env.PAGBANK_BASE_URL.replace(/\/+$/, "");
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function notificationUrl(): string {
  return `${env.APP_PUBLIC_URL.replace(/\/+$/, "")}/api/webhooks/payment/pagbank`;
}

interface PagBankOrderResponse {
  id?: string;
  qr_codes?: { id?: string; text?: string; links?: { media?: string; href?: string }[] }[];
  charges?: { status?: string }[];
}

export const pagBankGateway: PaymentGateway = {
  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const res = await fetch(`${base()}/orders`, {
      method: "POST",
      headers: headers(input.apiKey),
      body: JSON.stringify({
        reference_id: input.externalReference,
        // customer: ajustar aqui se a Fase 0 mostrar que é obrigatório.
        qr_codes: [{ amount: { value: input.amountCents } }], // CENTAVOS (inteiro)
        notification_urls: [notificationUrl()],
      }),
    });
    if (!res.ok) {
      throw new Error(`PagBank: falha ao criar cobrança (${res.status})`);
    }
    const order = (await res.json()) as PagBankOrderResponse;
    const qr = order.qr_codes?.[0];
    const pngLink = qr?.links?.find((l) => l.media === "image/png")?.href;

    return {
      providerChargeId: order.id ?? "",
      pixCopiaECola: qr?.text ?? "",
      pixQrCodeBase64: pngLink, // PagBank devolve URL da imagem (não base64); o front exibe direto
    };
  },

  async isChargePaid(apiKey: string, providerChargeId: string): Promise<boolean> {
    const res = await fetch(`${base()}/orders/${providerChargeId}`, {
      method: "GET",
      headers: headers(apiKey),
    });
    if (!res.ok) return false;
    const order = (await res.json()) as PagBankOrderResponse;
    return (order.charges ?? []).some((c) => c.status === "PAID");
  },

  async verifyCredential(apiKey: string): Promise<boolean> {
    // Chamada barata autenticada: token inválido → 401/403; qualquer outro → ok.
    const res = await fetch(`${base()}/orders/?reference_id=__verify__`, {
      method: "GET",
      headers: headers(apiKey),
    });
    return res.status !== 401 && res.status !== 403;
  },

  parseWebhookChargeId(body: unknown): string | null {
    const b = body as { id?: string } | null;
    return b?.id ?? null; // root id = id do pedido (= providerChargeId guardado)
  },
};
```
> **Nota sobre `pixQrCodeBase64`:** MP/Asaas devolvem base64; o PagBank devolve **URL** da imagem PNG. O campo é só conveniência do front (o essencial é o `pixCopiaECola`, que a IA manda como texto). Se algum consumidor assumir base64, tratar na exibição — mas hoje `enviar_oferta` usa só o copia-e-cola, então não bloqueia.

**Step 2 — Rodar e ver passar:**
```bash
npx vitest run src/server/payments/pagbank.test.ts
```
Expected: PASS.

**Step 3 — Commit:**
```bash
git add src/server/payments/pagbank.ts src/server/payments/pagbank.test.ts
git commit -m "feat(payments): gateway PagBank (Pix via Orders API) + testes"
```

---

# FASE 4 — Roteamento

### Task 4.1: `gatewayFor` roteia PAGBANK

**Files:**
- Modify: `src/server/payments/gateway.ts` (função `gatewayFor`, L30-32)
- Test: `src/server/payments/gateway.test.ts` (describe `gatewayFor`)

**Step 1 — Ampliar o teste** (no `it("mapeia o provider...")`):
```ts
    const { pagBankGateway } = await import("./pagbank");
    expect(gatewayFor("PAGBANK")).toBe(pagBankGateway);
```

**Step 2 — Rodar e ver falhar:**
```bash
npx vitest run src/server/payments/gateway.test.ts -t "mapeia o provider"
```
Expected: FAIL (`gatewayFor("PAGBANK")` cai no default MP).

**Step 3 — Implementar** (trocar o ternário por um `switch`/mapa, mais claro com 3 providers):
```ts
import type { PaymentProvider } from "@prisma/client";
import { asaasGateway } from "./asaas";
import { mercadoPagoGateway } from "./mercadopago";
import { pagBankGateway } from "./pagbank";

// ...interfaces inalteradas...

export function gatewayFor(provider: PaymentProvider): PaymentGateway {
  switch (provider) {
    case "ASAAS":
      return asaasGateway;
    case "PAGBANK":
      return pagBankGateway;
    case "MERCADO_PAGO":
    default:
      return mercadoPagoGateway;
  }
}
```

**Step 4 — Rodar e ver passar:**
```bash
npx vitest run src/server/payments/gateway.test.ts
```
Expected: PASS (todos).

**Step 5 — Commit:**
```bash
git add src/server/payments/gateway.ts src/server/payments/gateway.test.ts
git commit -m "feat(payments): gatewayFor roteia PAGBANK"
```

---

# FASE 5 — Webhook

### Task 5.1: Mapear `pagbank` no webhook `[provider]`

**Files:**
- Modify: `src/app/api/webhooks/payment/[provider]/route.ts` (L24-25)
- Test: `src/app/api/webhooks/payment/[provider]/route.test.ts` (já existe — ler o padrão e adicionar caso)

**Step 1 — Trocar o mapeamento** de ternário (só ASAAS/MP) por um mapa que reconhece os 3 provedores pelo slug da URL:
```ts
  const { provider: raw } = await params;
  const KEY = raw.toUpperCase();
  const provider: PaymentProvider =
    KEY === "ASAAS" ? "ASAAS" : KEY === "PAGBANK" ? "PAGBANK" : "MERCADO_PAGO";
```
> O slug vem do `notificationUrl()` de cada gateway: `mercadopago` → MERCADO_PAGO (default), `asaas` → ASAAS, `pagbank` → PAGBANK.

**Step 2 — Teste** (espelhar o caso existente do arquivo; ler primeiro `route.test.ts` para reusar os mocks de `confirmPaymentByCharge`/`gatewayFor`). Asserção mínima: um POST em `params={provider:"pagbank"}` com corpo `{ id: "ORDE_ABC" }` chama `confirmPaymentByCharge("PAGBANK", "ORDE_ABC")` e responde 200.

**Step 3 — Rodar:**
```bash
npx vitest run "src/app/api/webhooks/payment/[provider]/route.test.ts"
```
Expected: PASS.

**Step 4 — Commit:**
```bash
git add "src/app/api/webhooks/payment/[provider]"
git commit -m "feat(payments): webhook mapeia slug pagbank → PAGBANK"
```

---

# FASE 6 — Rota de credencial

### Task 6.1: Aceitar `PAGBANK` no POST de credencial

**Files:**
- Modify: `src/app/api/account/payment-key/route.ts` (o `bodySchema`, L15-18)

**Step 1 — Ampliar o enum Zod:**
```ts
const bodySchema = z.object({
  provider: z.enum(["MERCADO_PAGO", "ASAAS", "PAGBANK"]),
  apiKey: z.string().min(12),
});
```
> `savePaymentCredential` já é provider-agnóstica (chama `gatewayFor(provider).verifyCredential`), então nada mais muda no backend.

**Step 2 — Commit:**
```bash
git add src/app/api/account/payment-key/route.ts
git commit -m "feat(payments): rota de credencial aceita PAGBANK"
```

---

# FASE 7 — UI (Configurações)

### Task 7.1: Opção PagBank no seletor de gateway

**Files:**
- Modify: `src/components/app/AccountSettings.tsx` (type `PaymentProvider` L32; `PAYMENT_PROVIDER_LABEL` L41-44; `<select>` L594-596 e o `placeholder` L601)

**Step 1 — Ampliar o type e o label:**
```ts
type PaymentProvider = "MERCADO_PAGO" | "ASAAS" | "PAGBANK";

const PAYMENT_PROVIDER_LABEL: Record<PaymentProvider, string> = {
  MERCADO_PAGO: "Mercado Pago",
  ASAAS: "Asaas",
  PAGBANK: "PagBank",
};
```

**Step 2 — Adicionar a `<option>`:**
```tsx
                    <option value="MERCADO_PAGO">Mercado Pago</option>
                    <option value="ASAAS">Asaas</option>
                    <option value="PAGBANK">PagBank</option>
```

**Step 3 — Ajustar o `placeholder`** (hint do formato do token por provider):
```tsx
                    placeholder={
                      payProvider === "MERCADO_PAGO"
                        ? "Access Token (APP_USR-...)"
                        : payProvider === "PAGBANK"
                          ? "Token PagBank (Bearer)"
                          : "API Key ($aact_...)"
                    }
```

**Step 4 — Verificar visualmente** (`npm run dev` → /configuracoes → seção de pagamento): o seletor mostra os 3; escolher PagBank e colar um token de sandbox → "Conectar" deve validar (via `verifyCredential`) e mostrar `PagBank • conectado ••••XXXX`. Usar `/run` se precisar de apoio pra subir o app.

**Step 5 — Commit:**
```bash
git add src/components/app/AccountSettings.tsx
git commit -m "feat(payments/ui): opção PagBank no seletor de gateway"
```

---

# FASE 8 — Fechamento

### Task 8.1: Gate verde

**Step 1 — Suíte inteira:**
```bash
npm test
```
Expected: todos verdes (existentes + novos de gateway/webhook). Se o `tsc`/lint apontar `PaymentProvider` não exaustivo em algum `switch`/`Record`, completar com `PAGBANK`.

**Step 2 — Lint + types:**
```bash
npm run lint
npx tsc --noEmit
```
Expected: sem erros.

**Step 3 — Commit** (se houve ajuste):
```bash
git commit -am "test: gate verde para gateway PagBank"
```

---

### Task 8.2: Checklist de deploy (documentar; executar só com o dono)

1. **Supabase (PROD) — antes do deploy de código:** rodar `prisma/manual/2026-07-14-onda-j.sql` (a linha `ALTER TYPE ... ADD VALUE 'PAGBANK'`) no SQL Editor, **sozinha**. Sem isso, salvar credencial PAGBANK dá erro de enum.
2. **Envs (Vercel + worker Oracle):** setar `PAGBANK_BASE_URL=https://api.pagseguro.com` (produção). Confirmar `APP_PUBLIC_URL` correto (monta a `notification_url` do webhook) e `ENCRYPTION_KEY` presente (cifra o token) — ver `[[baileys-prod-constraints]]`, `[[worker-oracle-update-procedure]]`.
3. **PagBank (dono):** gerar o token de **produção** no painel PagBank e cadastrar 1 chave Pix na conta.
4. **Deploy web** (Vercel via CLI c/ token se push bloqueado — `[[vercel-hobby-push-block]]`) **+ worker** (o `enviar_oferta`/reconsulta roda no atendimento).
5. **Cadastrar o webhook** no painel PagBank apontando p/ `https://<app>/api/webhooks/payment/pagbank` (ou confiar no `notification_urls` enviado por pedido — validar no smoke).
6. **Smoke PROD:** conectar o token PagBank em /configuracoes → criar uma Oferta barata → num lead de teste disparar `enviar_oferta` → conferir que o Pix chega e, ao pagar, o webhook marca a Sale como paga (reconsulta).

> **Follow-up (segurança):** validar assinatura do webhook PagBank (hoje a defesa é a reconsulta via API, igual MP/Asaas). Registrar como dívida, não bloqueia.

---

### Task 8.3: Atualizar a memória

**Files:**
- Create: `C:\Users\Matheus\.claude\projects\c--Users-Matheus-Documents-WORK-teste-crm\memory\pagbank-gateway-feito.md`
- Modify: `...\memory\MEMORY.md` (uma linha no índice)

Registrar (`type: project`, com **Why/How to apply**): PagBank como 3º gateway Pix (BYOK), enum `PaymentProvider.PAGBANK`, `pagbank.ts` (Orders API, **valor em centavos**, providerChargeId = id do pedido, webhook slug `pagbank`), onda-j.sql (estado em PROD), env `PAGBANK_BASE_URL`. **InfinitePay ficou de fora** (API é link de checkout, não copia-e-cola — precisa de modelo novo de "link de pagamento"; reavaliar). Linkar `[[financeiro-billing-gate]]`, `[[pricing-plans-cost]]`, `[[prod-schema-drift-destravar]]`.

---

## Notas de escopo (o que ficou de fora, de propósito)

- **InfinitePay** — a API pública é um **link de checkout** (`POST api.checkout.infinitepay.io/links` → URL; auth por handle/InfiniteTag; confirmação por `POST /payment_check`), **não** um Pix copia-e-cola. Não encaixa na interface `PaymentGateway` atual (que devolve `pixCopiaECola`). Integrar exige estender a abstração para um provedor devolver um **link de pagamento** (a IA mandaria a URL clicável no WhatsApp) — iniciativa separada.
- **Validação de assinatura de webhook** (PagBank/MP/Asaas) — segue como follow-up; a reconsulta via API já protege contra corpo forjado.
- **`cobrar_comanda`** (Pix do total dinâmico da comanda) — iniciativa à parte já conversada; independe deste plano, mas se beneficia dele (mais um gateway disponível).
```
