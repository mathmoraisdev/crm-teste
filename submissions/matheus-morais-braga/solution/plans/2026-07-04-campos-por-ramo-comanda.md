# Campos por Ramo na Comanda + Captura de Lead — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` para implementar este plano tarefa a tarefa.

**Goal:** Fazer a comanda do Caixa capturar contatos como leads (telefone), suportar pessoa física/jurídica (CPF/CNPJ) e exibir campos personalizados por item dirigidos pelo ramo do negócio (ex.: revenda de veículos → placa/chassi/RENAVAM), com anexos de imagem/documento como fase final.

**Architecture:** Reaproveita o sistema de campos personalizados que hoje é exclusivo de Leads (`CustomFieldDef` + `Lead.customFields`), estendendo-o com um **escopo** (`LEAD | ORDER | ORDER_ITEM`). A comanda passa a criar/vincular um `Lead` por telefone (dedup) ao abrir. `Order` e `OrderItem` ganham uma coluna `customFields Json?`. O ramo (`User.businessTemplateId`) passa a sugerir um **preset** de campos, tornando-o funcional além de cosmético. Anexos ficam num modelo dedicado com Supabase Storage.

**Tech Stack:** Next.js 15 (App Router, route handlers), Prisma 6 + Postgres (Supabase), Zod, React 19, Tailwind, Vitest. Storage: `@supabase/supabase-js`.

---

## Contexto de código (leia antes de começar)

Arquivos-âncora que este plano toca ou espelha:

- Schema: [prisma/schema.prisma](../../prisma/schema.prisma) — `Lead` (L466), `Order` (L280), `OrderItem` (L304), `CustomFieldType` (L518), `CustomFieldDef` (L528).
- Serviços: [src/server/services/order.service.ts](../../src/server/services/order.service.ts), [lead.service.ts](../../src/server/services/lead.service.ts) (`createLead` L185), [custom-field.service.ts](../../src/server/services/custom-field.service.ts) (`mergeCustomFields` L133, `coerceValue` L158).
- API: [src/app/api/vendas/orders/route.ts](../../src/app/api/vendas/orders/route.ts), [.../orders/[id]/route.ts](../../src/app/api/vendas/orders/%5Bid%5D/route.ts), [src/app/api/custom-fields/route.ts](../../src/app/api/custom-fields/route.ts).
- UI: [src/components/vendas/OrderBoard.tsx](../../src/components/vendas/OrderBoard.tsx), [src/components/CustomFieldsManager.tsx](../../src/components/CustomFieldsManager.tsx), [src/components/LeadForm.tsx](../../src/components/LeadForm.tsx).
- Ramo: [src/lib/business-templates.ts](../../src/lib/business-templates.ts) (`BusinessTemplate` L52, `revenda-veiculos`).
- Tenant/auth: `getTenantContext()` → `{ tenantUserId, sessionUserId, perms: { canSettings } }`; `getTenantUserId()` em `@/lib/tenant`.
- Telefone: `normalizePhone` em `@/lib/phone` (assume Brasil, retorna E.164 ou `null`).

### Convenções firmes (não desvie)
- **Multi-tenant:** todo serviço recebe `accountId`/`userId` (= `tenantUserId`) e filtra por ele. Nunca query global.
- **Escrita em Order/OrderItem:** só quando `status === "ABERTA"`. Comanda fechada é imutável (ver `addItem` L57, `closeOrder` L93).
- **Snapshot:** `OrderItem` guarda `nameSnapshot`/`unitPriceCents`. `customFields` do item é dado próprio do item, não do catálogo — não precisa snapshot.
- **Money:** centavos (`Int`), helpers em `@/lib/money`.
- **Tema:** nunca hex fixo; use utilities de token (`text-ink`, `border-line-default`, `bg-card`, `text-slate-*`, `brand-*`). Ver memória [[design-tokens-dark-theme]].

### Migrations / PROD (crítico — ver [[crm-inbox-db-push-pending]] e [[estoque-modulo-plano]])
- **Dev:** pare o `next dev` antes de qualquer `prisma generate`/`migrate`/`db push` (lock de DLL no Windows — ver [[prisma-generate-dev-server-lock]]).
- **Este plano usa migrations versionadas** (o `build` roda `prisma migrate deploy`). Para cada mudança de schema: `npx prisma migrate dev --name <slug>` gera o SQL em `prisma/migrations/`.
- **PROD (Supabase):** rode `prisma migrate deploy` no deploy. Se o histórico de migrations estiver dessincronizado (features anteriores foram `db push`), aplique o SQL manualmente no Supabase SQL Editor **e** rode `prisma migrate resolve --applied <migration>` para marcar como aplicada. Cada tarefa de schema abaixo inclui o **SQL bruto** como fallback de aplicação manual.
- Após cada mudança de schema: `npx prisma generate` antes de compilar/testar.

### Padrão de teste (Vitest) — o repo tem DOIS estilos; use o certo por caso
- Rodar tudo: `npm test`. Um arquivo: `npx vitest run caminho/arquivo.test.ts`. Filtrar: `-t "nome"`.
- **Integração com banco real** — ex.: `order.service.test.ts`, `catalog.service.test.ts`, `stock.service.test.ts`. Criam um dono descartável com `makeOwner()` (**`prisma.user.create` de verdade**) e exercem o serviço real. Use para lógica relacional (comanda/item/lead com FK, dedup, transações, baixa de estoque). **Requer `DATABASE_URL` de teste** apontando pra um Postgres real — é assim que os testes de order/catalog já rodam hoje.
- **Prisma mockado** — ex.: `custom-field.service.test.ts`, `lead.service.test.ts`. `vi.mock("@/server/db/client")` + `await import()` dinâmico dentro de cada `it`; assertam montagem de `where`/args e lógica. Use para funções sem escrita relacional (`mergeCustomFields`, montagem de query).
- **Lógica pura** — ex.: `phone.test.ts`, `money.test.ts`. Import direto, sem prisma. Use para `normalizeDocument`.
- **ARQUIVOS QUE JÁ EXISTEM — NÃO recrie, ESTENDA no estilo que cada um usa:** `src/server/services/order.service.test.ts` (banco real), `src/server/services/lead.service.test.ts` (mockado, só `listLeads`), `src/server/services/custom-field.service.test.ts` (mockado).
- Commits em pt-BR (`feat(caixa): ...`, `feat(crm): ...`), um por tarefa concluída.

---

# FASE 1 — Captura de lead pela comanda (telefone)

**Resultado:** ao abrir uma comanda avulsa, um campo opcional de telefone cria-ou-vincula um `Lead` (dedup por telefone) e grava `leadId` na comanda. Sem mudança de schema. Vale para todo ramo.

**Decisão de design:** o telefone **não** vira coluna nova em `Order`. Ele flui para o `Lead` (fonte de verdade do contato); a comanda só guarda `leadId`. `customerName` continua para exibição.

---

### Tarefa 1.1: `openOrder` cria/vincula lead por telefone

**Files:**
- Modify: `src/server/services/order.service.ts` (função `openOrder`, L36-49)
- Test: `src/server/services/order.service.test.ts` (**JÁ EXISTE — banco real; ESTENDA**)

**Step 1 — Escreva o teste que falha.** O arquivo já existe e usa banco real (`makeOwner()`, sem mock). Adicione um `describe` ao final, no MESMO estilo:

```ts
describe("openOrder — captura de lead por telefone", () => {
  it("com telefone: cria lead e vincula na comanda", async () => {
    const acc = await makeOwner();
    const order = await openOrder(acc, { openedById: acc, customerName: "Zé", customerPhone: "11988887777" });
    expect(order.leadId).toBeTruthy();
    const lead = await prisma.lead.findFirst({ where: { userId: acc, id: order.leadId! } });
    expect(lead).toBeTruthy();
    expect(lead!.name).toBe("Zé");
  });

  it("reabrir com o mesmo telefone não duplica lead", async () => {
    const acc = await makeOwner();
    await openOrder(acc, { openedById: acc, customerPhone: "11988887777" });
    await openOrder(acc, { openedById: acc, customerPhone: "11988887777" });
    expect(await prisma.lead.count({ where: { userId: acc } })).toBe(1);
  });

  it("sem telefone: comanda avulsa pura (não cria lead)", async () => {
    const acc = await makeOwner();
    const order = await openOrder(acc, { openedById: acc, customerName: "Zé" });
    expect(order.leadId).toBeNull();
    expect(await prisma.lead.count({ where: { userId: acc } })).toBe(0);
  });
});
```
> Não asserte a string E.164 normalizada (evita acoplar ao `normalizePhone`): busque o lead por `id: order.leadId`. Os testes existentes de `openOrder` (sem telefone) continuam válidos — `createLead` só é chamado quando há telefone.

**Step 2 — Rode e veja falhar.** `npx vitest run src/server/services/order.service.test.ts` → FAIL (`openOrder` ainda não aceita `customerPhone`).

**Step 3 — Implemente.** Em `order.service.ts`, importe o serviço de lead no topo:

```ts
import { createLead } from "@/server/services/lead.service";
```

Substitua a assinatura e o corpo de `openOrder` (L36-49) por:

```ts
export async function openOrder(
  accountId: string,
  data: {
    openedById: string;
    leadId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null; // NOVO: se vier, cria/vincula lead por telefone
  },
): Promise<OrderDTO> {
  let leadId = data.leadId ?? null;

  // Captura de lead: telefone informado numa comanda avulsa → cria/vincula lead
  // (dedup por telefone dentro de createLead) e passa a tratar como comanda de lead.
  if (!leadId && data.customerPhone?.trim()) {
    const lead = await createLead(
      accountId,
      data.customerName?.trim() || "Sem nome",
      data.customerPhone.trim(),
    );
    leadId = lead.id;
  }

  const o = await prisma.order.create({
    data: {
      accountId,
      openedById: data.openedById,
      leadId,
      customerName: leadId ? null : (data.customerName?.trim() || "Sem nome"),
    },
    include: { items: true },
  });
  return toDTO(o);
}
```

> Nota: `createLead` lança em telefone inválido (`normalizePhone` retorna `null`). Isso propaga para a API como 400 (ver Tarefa 1.2), o que é o comportamento desejado (telefone digitado errado avisa o operador).

**Step 4 — Rode e veja passar.** `npx vitest run src/server/services/order.service.test.ts` → PASS.

**Step 5 — Commit.**
```bash
git add src/server/services/order.service.ts src/server/services/order.service.test.ts
git commit -m "feat(caixa): comanda cria/vincula lead por telefone ao abrir"
```

---

### Tarefa 1.2: API aceita `customerPhone`

**Files:**
- Modify: `src/app/api/vendas/orders/route.ts` (L14, `openSchema`)

**Step 1 — Ajuste o schema Zod.** Substitua L14:

```ts
const openSchema = z.object({
  leadId: z.string().nullish(),
  customerName: z.string().nullish(),
  customerPhone: z.string().nullish(), // NOVO
});
```

O `POST` já faz spread de `parsed.data` para `openOrder` (L23), então `customerPhone` passa automaticamente. `openOrder` já lança erro amigável em telefone inválido, capturado pelo `catch` → 400. Nenhuma outra mudança.

**Step 2 — Verifique tipo/compilação.** `npx tsc --noEmit` (ou `npm run build` sem deploy). Esperado: sem erros.

**Step 3 — Commit.**
```bash
git add src/app/api/vendas/orders/route.ts
git commit -m "feat(caixa): API de abertura de comanda aceita customerPhone"
```

---

### Tarefa 1.3: UI — campo telefone na Nova Comanda

**Files:**
- Modify: `src/components/vendas/OrderBoard.tsx` (`NewOrderCard`, L165-286)

**Step 1 — Adicione estado e campo.** Em `NewOrderCard`, ao lado de `customerName` (L172), adicione:

```tsx
const [customerPhone, setCustomerPhone] = useState("");
```

No `open()` (L179), limpe também o telefone no sucesso (após `setCustomerName("")`, L190):

```tsx
setCustomerPhone("");
```

**Step 2 — Renderize o input.** Dentro do bloco `<div className="flex gap-2">` (L220-235), transforme o layout para incluir telefone. Substitua o bloco do input+botão por:

```tsx
<div className="space-y-2">
  <input
    value={customerName}
    onChange={(e) => setCustomerName(e.target.value)}
    placeholder="Nome do cliente (avulso)"
    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
  />
  <div className="flex gap-2">
    <input
      value={customerPhone}
      onChange={(e) => setCustomerPhone(e.target.value)}
      onKeyDown={(e) =>
        e.key === "Enter" &&
        open({ customerName: customerName.trim() || "Sem nome", customerPhone: customerPhone.trim() || undefined })
      }
      placeholder="Telefone (vira lead no CRM)"
      className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
    />
    <Button
      size="sm"
      onClick={() =>
        open({ customerName: customerName.trim() || "Sem nome", customerPhone: customerPhone.trim() || undefined })
      }
      loading={saving}
    >
      <Plus size={14} /> Abrir
    </Button>
  </div>
  <p className="text-xs text-slate-400">
    Com telefone, o cliente vira um contato no CRM (se já existir, apenas vincula).
  </p>
</div>
```

Atualize a assinatura de `open` (L179) para aceitar telefone:

```tsx
async function open(payload: { customerName?: string; leadId?: string; customerPhone?: string }) {
```

**Step 3 — Verifique manualmente.** Rode `npm run dev`, vá em Caixa → aba Comandas → abra comanda com nome + telefone. Confirme que aparece um lead novo no CRM (aba Leads) com aquele telefone; reabrir com o mesmo telefone **não** duplica.

Use a skill `verify` para dirigir esse fluxo end-to-end.

**Step 4 — Commit.**
```bash
git add src/components/vendas/OrderBoard.tsx
git commit -m "feat(caixa): campo de telefone na nova comanda captura lead"
```

---

# FASE 2 — Pessoa física/jurídica (CPF/CNPJ) no Lead

**Resultado:** o Lead distingue PF/PJ e guarda um documento (CPF ou CNPJ). O formulário alterna rótulos. Vale para todo ramo (venda B2B).

> **Decisão de risco (2b) — telefone opcional:** hoje `Lead.phone` é obrigatório e é a chave de dedup. Empresas que passam só razão social + CNPJ (sem telefone) não conseguem virar lead. A Tarefa 2.3 torna o telefone opcional com dedup por documento como fallback. É **isolada e opcional** — as Tarefas 2.1/2.2 entregam PF/PJ sem tocar na obrigatoriedade do telefone. Só execute 2.3 se o negócio realmente precisa de leads sem telefone. **Blast radius de 2.3** (revise antes): `LeadListItem.phone: string` (L51), `createLead` (assume telefone), worker de inbound do WhatsApp (sempre tem telefone — não afetado), buscas por telefone.

---

### Tarefa 2.1: Schema — `PersonType` + `document`

**Files:**
- Modify: `prisma/schema.prisma` (enum novo + `Lead` L466-511)

**Step 1 — Adicione o enum e os campos.** Antes de `model Lead` adicione:

```prisma
enum PersonType {
  PF
  PJ
}
```

Dentro de `model Lead`, após `email` (L472), adicione:

```prisma
  personType        PersonType       @default(PF)
  document          String? // CPF (PF) ou CNPJ (PJ), só dígitos; opcional
```

**Step 2 — Gere a migration.** (pare o `next dev` antes)
```bash
npx prisma migrate dev --name lead_person_type_document
npx prisma generate
```

**SQL de fallback para PROD** (Supabase SQL Editor, se aplicar manual):
```sql
CREATE TYPE "PersonType" AS ENUM ('PF', 'PJ');
ALTER TABLE "Lead" ADD COLUMN "personType" "PersonType" NOT NULL DEFAULT 'PF';
ALTER TABLE "Lead" ADD COLUMN "document" TEXT;
```

**Step 3 — Verifique.** `npx prisma validate` → sem erros; `npx tsc --noEmit` → sem erros.

**Step 4 — Commit.**
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(crm): Lead ganha personType (PF/PJ) e document"
```

---

### Tarefa 2.2: Serviço + API + UI de PF/PJ

**Files:**
- Modify: `src/server/services/lead.service.ts` (`createLead` L185, `updateLead` L222, `LeadListItem` opcional)
- Modify: `src/app/api/leads/[id]/route.ts` (schema do PATCH) e `src/app/api/leads/route.ts` (schema do POST)
- Modify: `src/components/LeadForm.tsx`
- Test: `src/server/services/lead.service.test.ts` (criar ou estender)

**Step 1 — Teste (normalização de documento).** Crie um helper puro `normalizeDocument` e teste-o. Em `src/lib/document.ts`:

```ts
/** Mantém só dígitos; valida comprimento de CPF (11) ou CNPJ (14). Vazio → null. */
export function normalizeDocument(raw: string | null | undefined, type: "PF" | "PJ"): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const expected = type === "PJ" ? 14 : 11;
  if (digits.length !== expected) {
    throw new Error(type === "PJ" ? "CNPJ deve ter 14 dígitos." : "CPF deve ter 11 dígitos.");
  }
  return digits;
}
```

Teste em `src/lib/document.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeDocument } from "./document";

describe("normalizeDocument", () => {
  it("tira máscara do CPF", () => expect(normalizeDocument("123.456.789-09", "PF")).toBe("12345678909"));
  it("tira máscara do CNPJ", () => expect(normalizeDocument("12.345.678/0001-95", "PJ")).toBe("12345678000195"));
  it("vazio vira null", () => expect(normalizeDocument("", "PF")).toBeNull());
  it("comprimento errado lança", () => expect(() => normalizeDocument("123", "PF")).toThrow());
});
```
Rode: `npx vitest run src/lib/document.test.ts` → PASS (após criar o arquivo).

**Step 2 — Estenda `createLead` e `updateLead`.** Em `lead.service.ts`:

`createLead` (L185) — adicione parâmetros opcionais e grave:
```ts
export async function createLead(
  userId: string,
  name: string,
  rawPhone: string,
  rawEmail?: string,
  extra?: { personType?: "PF" | "PJ"; document?: string | null },
): Promise<Lead> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error(`Telefone inválido: ${rawPhone}`);
  const email = normalizeEmail(rawEmail);
  if (rawEmail?.trim() && !email) throw new Error(`E-mail inválido: ${rawEmail}`);
  const personType = extra?.personType ?? "PF";
  const document = normalizeDocument(extra?.document, personType); // import de "@/lib/document"

  const existing = await prisma.lead.findFirst({ where: { userId, phone }, select: { id: true } });
  let lead: Lead;
  if (existing) {
    lead = await prisma.lead.update({
      where: { id: existing.id },
      data: { name, ...(email ? { email } : {}), personType, ...(document ? { document } : {}) },
    });
  } else {
    await assertContactQuota(userId);
    lead = await prisma.lead.create({
      data: { userId, name, phone, email, personType, document, status: "NOVO", consentSource: "manual" },
    });
  }
  await invalidateLeadCaches(userId);
  return lead;
}
```

`updateLead` (L222) — aceite `personType`/`document`, **reaproveitando o `exists` já carregado** (sem query extra). Primeiro amplie o `select` do `exists` (L234-237) para incluir `personType`:
```ts
  const exists = await prisma.lead.findFirst({
    where: { id, userId },
    select: { id: true, customFields: true, personType: true }, // + personType
  });
```
Depois, no bloco de `data` e no corpo:
```ts
// dentro do tipo `data`:
    personType?: "PF" | "PJ";
    document?: string | null;
// dentro do corpo, após tratar email/optOut:
  if (data.personType !== undefined) patch.personType = data.personType;
  if (data.document !== undefined || data.personType !== undefined) {
    const type = data.personType ?? exists.personType; // tipo efetivo, sem 2ª query
    patch.document = normalizeDocument(data.document ?? null, type);
  }
```
> Import no topo: `import { normalizeDocument } from "@/lib/document";`

**Step 3 — API.** Nos schemas Zod de `POST /api/leads` (`createSchema`, route.ts L29) e `PATCH /api/leads/[id]` (`updateSchema`, L26), adicione:
```ts
  personType: z.enum(["PF", "PJ"]).optional(),
  document: z.string().nullish(),
```
- **POST** chama `createLead` **posicionalmente** (L47) — passe o 5º arg explícito:
  ```ts
  const lead = await createLead(userId, parsed.data.name, parsed.data.phone, parsed.data.email, {
    personType: parsed.data.personType,
    document: parsed.data.document,
  });
  ```
- **PATCH** chama `updateLead(id, userId, parsed.data)` (L53) — como repassa `parsed.data` inteiro, `personType`/`document` fluem automaticamente ao serviço. Sem mudança extra na rota.

**Step 4 — UI (`LeadForm.tsx`).** Adicione estado `personType`/`document` (espelhando `email`, L37-40), um `<select>` PF/PJ e um input de documento com rótulo dinâmico. Insira após o bloco de e-mail (L152):

```tsx
<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
  <div>
    <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de pessoa</label>
    <select
      value={personType}
      onChange={(e) => setPersonType(e.target.value as "PF" | "PJ")}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
    >
      <option value="PF">Pessoa física</option>
      <option value="PJ">Empresa (PJ)</option>
    </select>
  </div>
  <div>
    <label className="mb-1 block text-xs font-medium text-slate-600">
      {personType === "PJ" ? "CNPJ" : "CPF"} <span className="text-slate-400">(opcional)</span>
    </label>
    <input
      value={document}
      onChange={(e) => setDocument(e.target.value)}
      placeholder={personType === "PJ" ? "00.000.000/0000-00" : "000.000.000-00"}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
    />
  </div>
</div>
```
Quando `personType === "PJ"`, troque o rótulo do campo Nome (L116) para "Razão social" via expressão condicional. Inclua `personType`/`document` no `body` do `submit` (tanto create quanto edit).

Carregue os valores atuais no `useEffect` de edição a partir de `GET /api/leads/[id]` → `{ lead }`. **Confirmado:** `getLeadDetail` usa `include` sem `select` de escalares, então `personType`/`document` já vêm no objeto automaticamente — nenhuma mudança de projeção na rota é necessária.

**Step 5 — Teste + verifique.** Rode o teste puro: `npx vitest run src/lib/document.test.ts` → PASS. (O `lead.service.test.ts` é mockado e só cobre `listLeads`; a fiação de `createLead`/`updateLead` com documento é coberta pelo teste puro de `normalizeDocument` + verificação E2E — o repo não unita o caminho de escrita de `createLead`.) Depois `npm run dev`, edite um lead como PJ com CNPJ mascarado → salva só dígitos e os rótulos trocam para "Razão social"/"CNPJ". Use a skill `verify`.

**Step 6 — Commit.**
```bash
git add src/lib/document.ts src/lib/document.test.ts src/server/services/lead.service.ts src/app/api/leads src/components/LeadForm.tsx
git commit -m "feat(crm): PF/PJ com CPF/CNPJ no lead e formulário"
```

---

### Tarefa 2.3 (OPCIONAL, decisão de risco): telefone opcional + dedup por documento

> Só execute se o negócio precisa de leads **sem** telefone. Revise o blast radius acima.

**Files:**
- Modify: `prisma/schema.prisma` (`Lead.phone` → opcional)
- Modify: `src/server/services/lead.service.ts` (`createLead` dedup por documento quando sem telefone; `LeadListItem`)
- Modify: tipos que assumem `phone: string`

**Step 1 — Schema.** Mude `phone String` → `phone String?` (L471). O `@@unique([whatsAppNumberId, phone])` continua válido (Postgres permite múltiplos NULL). Migration:
```bash
npx prisma migrate dev --name lead_phone_optional
```
SQL de fallback:
```sql
ALTER TABLE "Lead" ALTER COLUMN "phone" DROP NOT NULL;
```

**Step 2 — `createLead`:** aceite telefone vazio; se sem telefone, dedup por `(userId, document)`; exija ao menos telefone **ou** documento (senão lança "Informe telefone ou documento").

**Step 3 — Tipos:** `LeadListItem.phone: string | null`; ajuste UI que renderiza telefone para tolerar `null` (ex.: `OrderBoard` `LeadHit`, kanban card).

**Step 4 — Testes** cobrindo: (a) cria por documento sem telefone; (b) dedup por documento não duplica; (c) sem telefone e sem documento → erro.

**Step 5 — Commit.**
```bash
git commit -am "feat(crm): telefone opcional no lead com dedup por documento"
```

---

# FASE 3 — Campos personalizados por escopo (comanda / item) + preset por ramo

**Resultado:** `CustomFieldDef` ganha `scope` (`LEAD | ORDER | ORDER_ITEM`). `Order` e `OrderItem` ganham `customFields Json?`. A UI da comanda renderiza campos de escopo ORDER (na comanda) e ORDER_ITEM (por item). O ramo sugere um preset (revenda-veiculos → placa/chassi/RENAVAM/ano/modelo).

---

### Tarefa 3.1: Schema — `scope` + colunas `customFields`

**Files:** `prisma/schema.prisma`

**Step 1 — Enum + campo scope.** Adicione:
```prisma
enum CustomFieldScope {
  LEAD
  ORDER
  ORDER_ITEM
}
```
Em `CustomFieldDef` (L528) adicione após `type`:
```prisma
  scope     CustomFieldScope @default(LEAD)
```
E troque `@@unique([userId, key])` por `@@unique([userId, scope, key])` (permite mesma `key` em escopos diferentes; ver Tarefa 3.2 sobre `slugifyKey`).

Em `Order` (L280), após `note`:
```prisma
  customFields Json?
```
Em `OrderItem` (L304), após `quantity`:
```prisma
  customFields Json?
```

**Step 2 — Migration.**
```bash
npx prisma migrate dev --name custom_field_scope_order_fields
npx prisma generate
```
SQL de fallback:
```sql
CREATE TYPE "CustomFieldScope" AS ENUM ('LEAD', 'ORDER', 'ORDER_ITEM');
ALTER TABLE "CustomFieldDef" ADD COLUMN "scope" "CustomFieldScope" NOT NULL DEFAULT 'LEAD';
-- troca do unique:
DROP INDEX IF EXISTS "CustomFieldDef_userId_key_key";
ALTER TABLE "CustomFieldDef" ADD CONSTRAINT "CustomFieldDef_userId_scope_key_key" UNIQUE ("userId", "scope", "key");
ALTER TABLE "Order" ADD COLUMN "customFields" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "customFields" JSONB;
```
> Confirme o nome real do índice antigo com `\d "CustomFieldDef"` no Supabase antes de dropar.

**Step 3 — Commit.**
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(caixa): CustomFieldDef ganha scope; Order/OrderItem ganham customFields"
```

---

### Tarefa 3.2: `custom-field.service` filtra por escopo

**Files:**
- Modify: `src/server/services/custom-field.service.ts`
- Test: `src/server/services/custom-field.service.test.ts` (**JÁ EXISTE — mockado; ESTENDA no mesmo estilo `await import()`**)

**Step 1 — Teste (estilo MOCKADO já usado no arquivo).** O `findMany` mockado ignora o `where`, então o teste (a) devolve as defs do escorpo simulado e (b) **assere que o `scope` foi para o `where`**:

```ts
it("mergeCustomFields filtra defs pelo escopo informado", async () => {
  const { prisma } = await import("@/server/db/client");
  (prisma.customFieldDef.findMany as any).mockResolvedValue([
    { key: "placa", type: "TEXT", options: null, label: "Placa" },
  ]);
  const { mergeCustomFields } = await import("./custom-field.service");
  const out = await mergeCustomFields("dono-1", null, { placa: "ABC1D23" }, "ORDER_ITEM");
  expect(out).toEqual({ placa: "ABC1D23" });
  expect((prisma.customFieldDef.findMany as any).mock.calls[0][0]).toEqual({
    where: { userId: "dono-1", scope: "ORDER_ITEM" },
  });
});
```
> **O 4º parâmetro `scope` DEVE ser opcional com default `"LEAD"`.** Os testes existentes chamam `mergeCustomFields(userId, current, patch)` com 3 args — mantê-lo opcional os preserva verdes (o mock ignora o `where`).

**Step 2 — Implemente.** Assinaturas ganham `scope` **opcional (default `"LEAD"`)**:
- `listDefs(userId, scope: CustomFieldScope = "LEAD")` → `where: { userId, scope }`. (A rota GET de leads chama `listDefs(userId)` → default LEAD → segue devolvendo os campos de lead existentes, que já nascem `scope=LEAD` pela migration.)
- `createDef(userId, { ..., scope })` → grava `scope` (default LEAD). Inclua `scope` no `data` do `prisma.customFieldDef.create` (L73).
- `mergeCustomFields(userId, current, patch, scope: CustomFieldScope = "LEAD")` → troca o `findMany` (L138) para `findMany({ where: { userId, scope } })`.
- `deleteDef`/`updateDef` já filtram por `id`+`userId` — sem mudança. `updateDef` **não** deve permitir trocar `scope` (imutável após criado; documente no JSDoc).
- `slugifyKey` inalterado — a colisão de key entre escopos passa a ser permitida pelo unique composto `(userId, scope, key)` da Tarefa 3.1.
- Call site em `lead.service.ts` (`updateLead`): passe `"LEAD"` explícito em `mergeCustomFields(userId, exists.customFields, data.customFields, "LEAD")` (clareza; o default já seria LEAD).

**Step 3 — Rode.** `npx vitest run src/server/services/custom-field.service.test.ts` → PASS (os testes antigos de 3 args + o novo). Rode a suíte toda (`npm test`) para pegar call sites quebrados.

**Step 4 — Commit.**
```bash
git add src/server/services/custom-field.service.ts src/server/services/custom-field.service.test.ts src/server/services/lead.service.ts
git commit -m "feat(caixa): campos customizados filtram e validam por escopo"
```

---

### Tarefa 3.3: API de custom-fields com escopo

**Files:**
- Modify: `src/app/api/custom-fields/route.ts` (GET filtra por `?scope=`; POST aceita `scope`)
- Modify: `src/app/api/custom-fields/[id]/route.ts` (sem mudança de scope no PATCH)

**Step 1 — GET:** leia `?scope=` (`z.enum(["LEAD","ORDER","ORDER_ITEM"]).catch("LEAD")`) e passe a `listDefs`.
**Step 2 — POST:** `createSchema` ganha `scope: z.enum([...]).default("LEAD")`; repassa a `createDef`.
**Step 3 — Compile** (`npx tsc --noEmit`) e **commit.**
```bash
git commit -am "feat(caixa): API de campos customizados aceita scope"
```

---

### Tarefa 3.4: `order.service` grava `customFields` em comanda e item

**Files:**
- Modify: `src/server/services/order.service.ts` (`OrderDTO`, `OrderItemDTO`, `toDTO`, `addItem`, + novas funções `setOrderCustomFields`/`setOrderItemCustomFields`)
- Test: `src/server/services/order.service.test.ts` (estender)

**Step 1 — Testes (banco real, estenda `order.service.test.ts`).** A def precisa existir de verdade (o `mergeCustomFields` real consulta o banco), então crie a def via `createDef` no próprio teste:

```ts
// imports no topo do arquivo de teste:
// import { createDef } from "./custom-field.service";
// import { setOrderItemCustomFields } from "./order.service";

describe("customFields por item da comanda", () => {
  it("grava e valida customFields em item de comanda ABERTA", async () => {
    const acc = await makeOwner();
    await createDef(acc, { label: "Placa", type: "TEXT", scope: "ORDER_ITEM" }); // key => "placa"
    const veiculo = await createCatalogItem(acc, { name: "Civic", priceCents: 7800000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    const withItem = await addItem(acc, o.id, { catalogItemId: veiculo.id, quantity: 1 });
    const itemId = withItem.items[0].id;
    const upd = await setOrderItemCustomFields(acc, o.id, itemId, { placa: "ABC1D23" });
    expect(upd.items[0].customFields).toEqual({ placa: "ABC1D23" });
  });

  it("rejeita key fora do escopo ORDER_ITEM", async () => {
    const acc = await makeOwner();
    const veiculo = await createCatalogItem(acc, { name: "Gol", priceCents: 5000000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    const withItem = await addItem(acc, o.id, { catalogItemId: veiculo.id, quantity: 1 });
    await expect(setOrderItemCustomFields(acc, o.id, withItem.items[0].id, { fantasma: "x" })).rejects.toThrow();
  });

  it("recusa gravar em comanda FECHADA", async () => {
    const acc = await makeOwner();
    await createDef(acc, { label: "Placa", type: "TEXT", scope: "ORDER_ITEM" });
    const veiculo = await createCatalogItem(acc, { name: "Onix", priceCents: 6000000 });
    const o = await openOrder(acc, { openedById: acc, customerName: "X" });
    const withItem = await addItem(acc, o.id, { catalogItemId: veiculo.id, quantity: 1 });
    await closeOrder(acc, o.id, { payment: "DINHEIRO", closedById: acc });
    await expect(setOrderItemCustomFields(acc, o.id, withItem.items[0].id, { placa: "X" })).rejects.toThrow(/fechada/i);
  });
});
```
> `createCatalogItem`, `openOrder`, `addItem`, `closeOrder` já são importados no arquivo. Adicione só `createDef` e `setOrderItemCustomFields`.

**Step 2 — Implemente.**
- `OrderDTO`/`OrderItemDTO`: adicione `customFields: Record<string, unknown> | null`. `toDTO` propaga (`o.customFields ?? null`, e por item).
- `loadOwned` já inclui items; adicione `customFields` na projeção (é coluna, vem por padrão).
- `addItem` (L51): aceite `customFields?: Record<string, unknown>` no `data`, valide com `mergeCustomFields(accountId, null, data.customFields ?? {}, "ORDER_ITEM")` e grave.
- Novas funções:
```ts
export async function setOrderCustomFields(accountId: string, orderId: string, patch: Record<string, unknown>): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const merged = await mergeCustomFields(accountId, order.customFields, patch, "ORDER");
  await prisma.order.update({ where: { id: orderId }, data: { customFields: merged as Prisma.InputJsonValue } });
  return toDTO(await loadOwned(accountId, orderId));
}

export async function setOrderItemCustomFields(accountId: string, orderId: string, itemId: string, patch: Record<string, unknown>): Promise<OrderDTO> {
  const order = await loadOwned(accountId, orderId);
  if (order.status !== "ABERTA") throw new Error("Comanda já fechada.");
  const item = order.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Item não encontrado.");
  const merged = await mergeCustomFields(accountId, item.customFields, patch, "ORDER_ITEM");
  await prisma.orderItem.update({ where: { id: itemId }, data: { customFields: merged as Prisma.InputJsonValue } });
  return toDTO(await loadOwned(accountId, orderId));
}
```
Imports: `mergeCustomFields` de `@/server/services/custom-field.service`; `Prisma` de `@prisma/client`.

**Step 3 — Rode testes** → PASS. **Commit.**
```bash
git commit -am "feat(caixa): comanda e item aceitam customFields por escopo"
```

---

### Tarefa 3.5: Rotas de API para gravar customFields

**Files:**
- Create: `src/app/api/vendas/orders/[id]/fields/route.ts` (PATCH → `setOrderCustomFields`)
- Modify: `src/app/api/vendas/orders/[id]/items/route.ts` (POST aceita `customFields`)
- Create: `src/app/api/vendas/orders/[id]/items/[itemId]/fields/route.ts` (PATCH → `setOrderItemCustomFields`)

Espelhe o padrão de `[id]/route.ts` (getTenantContext, `params: Promise<{ id: string }>` / `Promise<{ id: string; itemId: string }>`, zod, try/catch 400). Body no **formato de duas-args do repo** (ver `leads/[id]` L33): `z.object({ customFields: z.record(z.string(), z.unknown()) })`.

**Step — Compile + commit.**
```bash
git commit -am "feat(caixa): rotas para gravar customFields de comanda e item"
```

---

### Tarefa 3.6: UI — campos por escopo na comanda

**Files:**
- Modify: `src/components/vendas/OrderBoard.tsx` (`OrderPanel` L291; interfaces `Order`/`OrderItem` L11-29)
- Create: `src/components/vendas/OrderCustomFields.tsx` (componente reutilizável de render/edição, extraído do padrão de `LeadForm` L188-233)

**Step 1 — Componente reutilizável.** Crie `OrderCustomFields.tsx` que recebe `defs: CustomFieldDefItem[]`, `values: Record<string, unknown>`, `onSave: (patch) => Promise<void>` e renderiza inputs por tipo (TEXT/NUMBER/DATE/SELECT/BOOLEAN) — **DRY**: reutiliza a mesma lógica de input de `LeadForm` (L188-233). Extraia essa lógica de input num componente `CustomFieldInput` compartilhado por `LeadForm` e `OrderCustomFields` para não duplicar.

**Step 2 — Carregue defs no `OrderBoard`.** Adicione dois fetches: `GET /api/custom-fields?scope=ORDER` e `?scope=ORDER_ITEM`, guardados em estado e passados a `OrderPanel`.

**Step 3 — Renderize.** Em `OrderPanel`:
- Interfaces `Order` e `OrderItem` ganham `customFields: Record<string, unknown> | null`.
- Abaixo do `CardHeader` (L366), se `orderDefs.length > 0`, renderize `<OrderCustomFields>` (escopo ORDER) que faz `PATCH /api/vendas/orders/${order.id}/fields` no blur/salvar.
- Em cada `<li>` de item (L373-395), se `itemDefs.length > 0`, adicione um bloco expansível com `<OrderCustomFields>` (escopo ORDER_ITEM) que faz `PATCH .../items/${it.id}/fields`.

**Step 4 — Verifique end-to-end.** Configure (Fase 3.7) campos ORDER_ITEM "Placa"/"Chassi"; abra comanda, adicione um veículo, preencha placa/chassi, recarregue → persistiu. Use skill `verify`.

**Step 5 — Commit.**
```bash
git add src/components/vendas/OrderBoard.tsx src/components/vendas/OrderCustomFields.tsx src/components/LeadForm.tsx
git commit -m "feat(caixa): comanda renderiza campos customizados por comanda e por item"
```

---

### Tarefa 3.7: Preset de campos por ramo

**Files:**
- Modify: `src/lib/business-templates.ts` (tipo `BusinessTemplate` + `revenda-veiculos` e `oficina-mecanica`)
- Create: `src/server/services/custom-field-preset.service.ts` (semeia defs a partir do preset)
- Create: `src/app/api/custom-fields/seed-preset/route.ts` (POST)
- Modify: `src/components/CustomFieldsManager.tsx` (seletor de escopo + botão "usar campos do ramo")
- Modify: `src/app/(app)/configuracoes/page.tsx` (passa `businessTemplateId` ao manager)

**Step 1 — Tipo de preset.** Em `BusinessTemplate` (L52) adicione:
```ts
  customFieldsPreset?: {
    scope: "ORDER" | "ORDER_ITEM";
    label: string;
    type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "BOOLEAN";
    options?: string[];
  }[];
```
No template `revenda-veiculos` (e opcionalmente `oficina-mecanica`), adicione:
```ts
    customFieldsPreset: [
      { scope: "ORDER_ITEM", label: "Placa", type: "TEXT" },
      { scope: "ORDER_ITEM", label: "Chassi", type: "TEXT" },
      { scope: "ORDER_ITEM", label: "RENAVAM", type: "TEXT" },
      { scope: "ORDER_ITEM", label: "Ano/Modelo", type: "TEXT" },
      { scope: "ORDER_ITEM", label: "KM", type: "NUMBER" },
      { scope: "ORDER_ITEM", label: "Cor", type: "TEXT" },
    ],
```

**Step 2 — Serviço de seed (idempotente por pré-carga, não por catch).** `seedCustomFieldPreset(userId, templateId)`:
- Pega `getTemplate(templateId)?.customFieldsPreset` (retorna `{ created: 0, skipped: 0 }` se o template não tiver preset).
- Pré-carrega as defs existentes do usuário (`listDefs` por escopo, ou um `findMany`) e monta um `Set` de `(scope|key)` já existentes.
- Para cada item do preset, computa `key = slugifyKey(item.label)`; se `(scope|key)` já existe, incrementa `skipped`; senão chama `createDef(userId, { label, type, options, scope })` e incrementa `created`.
- **Não** dependa de capturar o P2002 — `createDef` converte P2002 numa `Error` amigável ("Já existe…"), que não é um sinal confiável de "pular". A pré-carga evita a corrida e a exceção.
- Retorna `{ created, skipped }`.

**Step 3 — API.** `POST /api/custom-fields/seed-preset` (perms `canSettings`): lê `businessTemplateId` da conta (`getBusinessTemplateId`), chama o serviço. Sem body.

**Step 4 — UI.** Em `CustomFieldsManager`:
- Adicione um `<select>` de escopo (Lead / Comanda / Item da comanda) no formulário de criação e um filtro de listagem por escopo (busca `GET /api/custom-fields?scope=`). Ajuste o subtítulo/texto por escopo.
- Botão "Usar campos do meu ramo (\<label\>)" visível quando a conta tem `businessTemplateId` com preset → chama `seed-preset` e recarrega.
- `configuracoes/page.tsx`: passe `businessTemplateId` (já buscado em L41) como prop ao `CustomFieldsManager`.

**Step 5 — Verifique.** Como conta "revenda-veiculos": Configurações → Campos → "Usar campos do meu ramo" → cria as defs ORDER_ITEM; rodar de novo não duplica. Depois valide na comanda (3.6). Skill `verify`.

**Step 6 — Commit.**
```bash
git add src/lib/business-templates.ts src/server/services/custom-field-preset.service.ts src/app/api/custom-fields/seed-preset src/components/CustomFieldsManager.tsx src/app/\(app\)/configuracoes/page.tsx
git commit -m "feat(caixa): ramo sugere preset de campos; seed idempotente"
```

---

# FASE 4 — Anexos (imagens / documentos)

**Resultado:** itens de comanda (e/ou comanda) aceitam anexos de imagem/PDF (fotos do veículo, CRLV, laudo) via Supabase Storage. Maior esforço; isolado.

> **Decisão de modelagem:** anexos **não** entram em `customFields` (que guarda escalares JSON). Ficam num modelo dedicado `OrderAttachment` referenciando Storage, seguindo o padrão de mídia já existente no worker (ver [[media-retention-design]] e [[ai-context-and-media-policy]] para convenções de Storage/retention). Reuse o client Supabase já configurado.

---

### Tarefa 4.1: Schema `OrderAttachment`

**Files:** `prisma/schema.prisma`

```prisma
model OrderAttachment {
  id          String   @id @default(cuid())
  accountId   String   // tenant
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  orderItemId String?  // null = anexo da comanda; preenchido = do item
  orderItem   OrderItem? @relation(fields: [orderItemId], references: [id], onDelete: Cascade)
  storagePath String   // caminho no bucket
  fileName    String
  mimeType    String
  sizeBytes   Int
  createdById String
  createdAt   DateTime @default(now())
  @@index([orderId])
  @@index([orderItemId])
  @@index([accountId])
}
```
Adicione as relações inversas em `Order` (`attachments OrderAttachment[]`) e `OrderItem` (`attachments OrderAttachment[]`). Migration `order_attachments` + SQL de fallback (CREATE TABLE + índices + FKs).

**Commit:** `feat(caixa): modelo OrderAttachment`.

---

### Tarefa 4.2: Upload service + Storage

**Files:** `src/server/services/order-attachment.service.ts`, client Supabase existente.

- Defina bucket (ex.: `order-attachments`, privado). Documente criação do bucket no Supabase (dashboard ou SQL) no cabeçalho do serviço.
- `uploadAttachment({ accountId, orderId, orderItemId?, file })`: valida mime (image/*, application/pdf) e tamanho (ex.: ≤ 10MB); path `${accountId}/${orderId}/${cuid}-${fileName}`; `supabase.storage.from(bucket).upload(...)`; grava `OrderAttachment`. Só comanda ABERTA.
- `listAttachments`, `deleteAttachment` (apaga do Storage + linha), `signedUrl(attachment)` (URL assinada temporária p/ preview).
- Escreva testes de validação de mime/tamanho (unitário, mockando Storage).

**Commit:** `feat(caixa): upload/list/delete de anexos de comanda`.

---

### Tarefa 4.3: API + UI de anexos

**Files:**
- `src/app/api/vendas/orders/[id]/attachments/route.ts` (POST multipart, GET lista com signed URLs)
- `src/app/api/vendas/orders/[id]/attachments/[attId]/route.ts` (DELETE)
- Modify `OrderBoard.tsx` (`OrderPanel` + item): botão de upload (input file), thumbnails/links de anexos, remover com `ConfirmDeleteButton` (ver [[caixa-despesas-reposicionamento]] p/ padrão de confirmação de exclusão).

Verifique end-to-end: subir foto num item, ver preview, remover. Skill `verify`.

**Commit:** `feat(caixa): UI de anexos (imagem/PDF) na comanda`.

---

## Ordem de entrega recomendada
1. **Fase 1** (captura de lead) — maior valor, menor custo, todo ramo. Ship isolado.
2. **Fase 2.1/2.2** (PF/PJ) — ship. **2.3** só se necessário.
3. **Fase 3** — campos por escopo + preset por ramo (o pedido central da revenda de veículos).
4. **Fase 4** — anexos (quando houver banda para o fluxo de upload).

## Checklist de fechamento por fase
- [ ] `npm test` verde.
- [ ] `npx tsc --noEmit` sem erros.
- [ ] `npm run lint` sem erros novos.
- [ ] Fluxo dirigido pela skill `verify` (não só teste).
- [ ] Migration versionada em `prisma/migrations/` **e** SQL de fallback conferido para PROD.
- [ ] Nada de hex fixo / respeita tema (memória [[design-tokens-dark-theme]]).

## Riscos conhecidos
- **Telefone opcional (2.3):** muda um invariante antigo (`Lead.phone` não-nulo). Blast radius listado na fase. Não faça de graça.
- **Troca do unique de `CustomFieldDef` (3.1):** confirme o nome real do índice antigo antes de dropar em PROD.
- **Colisão de key entre escopos:** resolvida pelo unique composto `(userId, scope, key)`. `mergeCustomFields` DEVE filtrar por escopo (3.2) — senão um campo de LEAD seria aceito numa comanda.
- **PROD dessincronizado de migrations:** features anteriores (estoque) foram `db push`. Antes do primeiro `migrate deploy`, valide o histórico e use `migrate resolve --applied` se preciso (ver [[crm-inbox-db-push-pending]]).

---

## Revisão final — verificações contra o código (2026-07-04) · CONGELADO

Este plano foi revisado arquivo a arquivo. Correções aplicadas nesta revisão (o que teria feito a implementação falhar):

1. **Padrão de teste estava errado.** O plano mandava mockar Prisma em `order.service.test.ts`, mas esse arquivo (como `catalog.service.test.ts`/`stock.service.test.ts`) usa **banco real** via `makeOwner()`. Já `custom-field.service.test.ts` e `lead.service.test.ts` usam **prisma mockado** com `await import()`. As Tarefas 1.1, 3.2 e 3.4 foram reescritas para o estilo real de cada arquivo.
2. **Arquivos de teste já existem** (`order/lead/custom-field .service.test.ts`) — plano dizia "criar"; agora diz **estender**.
3. **`mergeCustomFields` é chamado com 3 args hoje** — o 4º (`scope`) foi definido como **opcional, default `"LEAD"`**, preservando os testes atuais e os campos de lead existentes (que nascem `scope=LEAD` pela migration).
4. **`POST /api/leads` chama `createLead` posicionalmente** — a passagem de `personType`/`document` foi explicitada como 5º arg; o `PATCH` já repassa `parsed.data` inteiro (nada extra).
5. **`updateLead`** passou a reaproveitar o `exists` já carregado (adiciona `personType` ao `select`) em vez de uma 2ª query com `!`.
6. **`GET /api/leads/[id]`** já devolve `personType`/`document` (usa `include` sem `select` de escalares) — nenhuma mudança de projeção.
7. **`z.record`** alinhado ao formato de duas-args do repo: `z.record(z.string(), z.unknown())`.
8. **Seed de preset** ficou idempotente por **pré-carga de keys**, não por capturar P2002 (que `createDef` converte em `Error`).

Verificado e confirmado OK (sem mudança necessária):
- `getTenantContext()` → `{ tenantUserId, sessionUserId, role, perms: { canSettings, leadsScope, canCampaigns } }`.
- `invalidateLeadCaches` é **no-op sem Redis** → testes de integração de captura de lead rodam sem Redis.
- Rotas de itens já existem: `orders/[id]/items/route.ts` e `orders/[id]/items/[itemId]/route.ts`.
- `business-templates.test.ts` **não** faz assert exaustivo por template → o `customFieldsPreset` opcional não o quebra. `getTemplate` é exportado. `revenda-veiculos` existe (L599), `oficina-mecanica` (L87).
- `configuracoes/page.tsx` já busca `businessTemplateId` (L41) → só passar como prop ao `CustomFieldsManager` (hoje renderizado sem props de ramo, L88).

**Pré-requisito de ambiente:** as Fases 1 e 3 têm testes de integração (banco real) — precisam de `DATABASE_URL` de teste apontando pra um Postgres, igual aos testes de order/catalog já existentes. Sem isso, rode ao menos os testes puros/mockados + a skill `verify`.

**Status: pronto para implementação.** Comece pela Fase 1 (isolada, sem schema).
