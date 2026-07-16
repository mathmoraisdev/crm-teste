# Funil por Ramo + Automações de Agenda/Proposta Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fazer o funil "ler" coerente por ramo (renomear os 8 estágios, não só 2) e ampliar o catálogo de automações de ciclo de vida com 3 toques que ancoram em **agendamento** e **proposta** — não em comanda — para que o negócio consultivo (imóveis, corretor, agência) finalmente receba automação além do reengajamento.

**Architecture:** Duas frentes independentes e baratas, sem entidade nova e sem múltiplos funis. **Frente A** é puro conteúdo: presets completos de `pipelineLabels` (os 8 `LeadStatus`) nos templates consultivos, aplicados pelo caminho que já existe (`setPipelineLabels` no onboarding). **Frente B** copia o padrão já provado em `lifecycle-automation.ts`: novos passes puros+idempotentes que reusam o helper `isDueAfter`, entram no array de `dispatchLifecycleAutomations` (herdando kill-switch + janela + opt-in de graça), e gravam o marcador SÓ após enviar. Precisa de exatamente **2 colunas nullable** (uma no `Appointment`, uma no `Lead`) e **3 envs** (todas default 0 = off → sobe inerte, como as atuais).

**Tech Stack:** Next.js (App Router) · Prisma · Postgres (Supabase, pooler de transação) · worker Node no Oracle · Vitest (unit p/ templates; integração contra o Postgres local do Docker p/ os passes) · TypeScript.

---

## Decisões de design (leia antes de começar)

1. **Nada de múltiplos funis nem flow builder.** O funil continua sendo o `enum LeadStatus` único, movido pela IA (`decidePipeline`). Esta entrega só melhora os **rótulos** por ramo. Múltiplas esteiras (venda × locação × captação) são explicitamente fora de escopo — reabrir só com um cliente pagante travando nisso.

2. **Presets de funil = conteúdo versionado, não dado de tenant.** Vivem em `business-templates.ts` como os outros campos do template. O onboarding já os aplica em `applyVertical` via `setPipelineLabels` ([vertical-onboarding.service.ts:97-100](src/server/services/vertical-onboarding.service.ts#L97)). **Só afeta onboarding novo** (ou re-aplicação do ramo) — backfill de contas existentes é fora de escopo (a conta pode reeditar os rótulos na tela do funil quando quiser).

3. **DRY nos rótulos.** Imobiliária e corretor de imóveis compartilham a mesma esteira → definir constantes (`FUNIL_IMOVEIS`, `FUNIL_VEICULOS`, `FUNIL_SERVICO_CONSULTIVO`) no topo de `business-templates.ts` e referenciar por spread, não repetir o objeto.

4. **Automações novas ancoram em `Appointment`/`Lead`, nunca em `Order`.** É esse o buraco: `dispatchPostSale`/`dispatchReviewRequests` filtram `Order.status = FECHADA` ([lifecycle-automation.ts:58-70](src/server/services/lifecycle-automation.ts#L58)), então imóveis (que não passa comanda) só recebia reengajamento. Os passes novos reusam o mesmo shape de lead (`LEAD_SELECT`) e a mesma disciplina de idempotência.

5. **Um marcador só resolve as duas automações de agenda.** `REALIZADO` e `FALTOU` são status **mutuamente exclusivos** de um mesmo `Appointment` → uma coluna `Appointment.lifecycleTouchedAt` serve para os dois (o agendamento recebe no máximo um dos dois toques). Não crie duas colunas.

6. **Follow-up de proposta assume o status `OFERTA_ENVIADA` sozinho.** Hoje o reengajamento inclui `OFERTA_ENVIADA` no `status: { in: [...] }` ([lifecycle-automation.ts:130](src/server/services/lifecycle-automation.ts#L130)). Para não haver **toque duplo**, o passe novo passa a ser o dono desse status e o reengajamento **remove** `OFERTA_ENVIADA` da lista. Marcador dedicado `Lead.proposalNudgedAt`.

7. **Só agendamento COM lead.** Walk-in sem `leadId` (só `customerName`/`customerPhone`) exige outro caminho de envio — fora de escopo v1. Os passes de agenda filtram `leadId: { not: null }` e mandam pelo `lead` (reusa `sendWhatsAppMessage(lead, …)`).

8. **Tudo default-off e opt-in por conta.** Cada passe novo tem seu env de atraso (0 = desligado, igual aos atuais) e respeita `account.lifecycleAutomationEnabled`. Herdam o kill-switch global `LIFECYCLE_AUTOMATION` e a janela comercial só por entrarem no array de `dispatchLifecycleAutomations` — **não** duplique esses guards nos passes.

9. **Textos padrão neutros, sem override por conta (v1).** Espelha `DEFAULT_POSTSALE`/`DEFAULT_REVIEW`/`DEFAULT_REENGAGE` em `lib/lifecycle.ts`. Override por conta é uma evolução futura, fora daqui.

**Convenções de teste (confirmadas no repo):**
- Templates: teste unit puro (sem DB). Veja `src/lib/business-templates.test.ts`.
- Passes de lifecycle: integração contra o Postgres local (Docker `crm-postgres`, precisa estar de pé). Helper `makeOwner()` cria `prisma.user.create({ data: { email: unique, name, passwordHash: "x" } })` — copie de um `*.service.test.ts`.
- Rodar um arquivo: `npx vitest run <caminho>`. Tudo: `npx vitest run`.
- Antes de qualquer `prisma db push`/`generate`: **pare o `next dev`** (senão EPERM no rename da DLL do query-engine — ver memória do projeto).
- Envs novas: registrar em `src/lib/env.ts` (schema zod) **e** no `.env.example` se houver.

---

## Fase A — Funil coerente por ramo (só rótulos)

### Task A.1: Constantes de esteira + guard test

**Files:**
- Modify: `src/lib/business-templates.ts` (topo, perto de `CATEGORY_LABEL`)
- Test: `src/lib/business-templates.test.ts`

**Step 1: Escrever o teste que falha**

Adicione em `business-templates.test.ts`:

```ts
import { BUSINESS_TEMPLATES } from "./business-templates";
import { PIPELINE_ORDER } from "./leadStatus";

// Ramos consultivos onde o funil é usado de fato: devem renomear os 8 estágios.
const CONSULTIVOS = ["imobiliaria", "corretor-imoveis", "revenda-veiculos", "agencia-marketing"];

describe("presets de funil por ramo", () => {
  it("ramos consultivos renomeiam TODOS os 8 estágios do LeadStatus", () => {
    for (const id of CONSULTIVOS) {
      const tpl = BUSINESS_TEMPLATES.find((t) => t.id === id);
      expect(tpl, `template ${id} existe`).toBeTruthy();
      const labels = tpl!.pipelineLabels ?? {};
      for (const status of PIPELINE_ORDER) {
        expect(typeof labels[status], `${id}.${status}`).toBe("string");
        expect((labels[status] as string).trim().length).toBeGreaterThan(0);
      }
    }
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/business-templates.test.ts`
Expected: FAIL — imobiliária/etc. hoje só têm 2 chaves.

**Step 3: Definir as constantes de esteira**

No topo de `business-templates.ts` (após `CATEGORY_LABEL`). **`LeadStatus` já está importado na linha 8 — não reimporte.**

```ts
/** Esteiras nomeadas por ramo — os 8 LeadStatus renomeados p/ ler coerente.
 *  Compartilhadas por ramos de mesmo processo (DRY). Aplicadas via setPipelineLabels. */
const FUNIL_IMOVEIS: Record<LeadStatus, string> = {
  NOVO: "Novo contato",
  CONTATADO: "Contactado",
  EM_CONVERSA: "Entendendo o perfil",
  QUALIFICADO: "Perfil qualificado",
  REUNIAO_AGENDADA: "Visita agendada",
  OFERTA_ENVIADA: "Proposta enviada",
  PAGO: "Negócio fechado",
  DESCARTADO: "Sem interesse",
};

const FUNIL_VEICULOS: Record<LeadStatus, string> = {
  NOVO: "Novo interessado",
  CONTATADO: "Contactado",
  EM_CONVERSA: "Entendendo a necessidade",
  QUALIFICADO: "Qualificado",
  REUNIAO_AGENDADA: "Test drive agendado",
  OFERTA_ENVIADA: "Proposta enviada",
  PAGO: "Vendido",
  DESCARTADO: "Sem interesse",
};

const FUNIL_SERVICO_CONSULTIVO: Record<LeadStatus, string> = {
  NOVO: "Novo lead",
  CONTATADO: "Contactado",
  EM_CONVERSA: "Levantando necessidade",
  QUALIFICADO: "Qualificado",
  REUNIAO_AGENDADA: "Reunião agendada",
  OFERTA_ENVIADA: "Proposta enviada",
  PAGO: "Fechado",
  DESCARTADO: "Sem interesse",
};
```

**Step 4: Referenciar nos templates**

Troque o `pipelineLabels` inline dos templates:
- `imobiliaria` ([~1975](src/lib/business-templates.ts#L1975)): `pipelineLabels: FUNIL_IMOVEIS,`
- `corretor-imoveis` ([~1596](src/lib/business-templates.ts#L1596), hoje sem funil): adicionar `pipelineLabels: FUNIL_IMOVEIS,`
- `revenda-veiculos` ([~684](src/lib/business-templates.ts#L684), hoje sem funil): adicionar `pipelineLabels: FUNIL_VEICULOS,`
- `agencia-marketing` ([~1625](src/lib/business-templates.ts#L1625), hoje sem funil): adicionar `pipelineLabels: FUNIL_SERVICO_CONSULTIVO,`

**Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/business-templates.test.ts`
Expected: PASS.

**Step 6: `tsc` limpo + commit**

Run: `npx tsc --noEmit`
```bash
git add src/lib/business-templates.ts src/lib/business-templates.test.ts
git commit -m "feat(funil): presets completos de esteira por ramo consultivo (imoveis/veiculos/agencia)"
```

> **Nota de aplicação:** nenhum outro código muda — `setPipelineLabels` já filtra chaves inválidas e `resolveStatusMeta` já mescla rótulo sobre o default mantendo tom/ordem. O onboarding de um ramo consultivo passa a nomear os 8 estágios automaticamente.

### Task A.2: Captura da CNH do comprador no ramo de veículos

**Contexto:** hoje `revenda-veiculos` semeia campos do **veículo** (`ORDER_ITEM`/`PRODUCT`) mas **nada do comprador**. E o tipo do `customFieldsPreset` **proíbe** escopo `LEAD` — embora `seedCustomFieldPreset` já passe `scope` reto pro `createDef` ([custom-field-preset.service.ts:33](src/server/services/custom-field-preset.service.ts#L33)). Numa revenda o comprador **sempre** entrega a CNH completa (financiamento/transferência). Decisão do dono: os campos são **preenchidos pelo vendedor no fechamento** — a IA **nunca** pede documento pelo chat.

**Files:**
- Modify: `src/lib/business-templates.ts` (tipo `BusinessTemplate.customFieldsPreset` [~68](src/lib/business-templates.ts#L68); template `revenda-veiculos` [~669](src/lib/business-templates.ts#L669))
- Test: `src/lib/business-templates.test.ts`

**Step 1: Abrir o tipo pra aceitar LEAD**

Em `business-templates.ts`, no tipo do preset:

```ts
  customFieldsPreset?: {
    scope: "LEAD" | "ORDER" | "ORDER_ITEM" | "PRODUCT";
    label: string;
    type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "BOOLEAN";
    options?: string[];
  }[];
```

> Confirme que `createDef` aceita `scope: "LEAD"` (o enum `CustomFieldScope` tem `LEAD` e o LeadForm já renderiza campos LEAD — deve compilar direto). Se `createDef` tipar por `CustomFieldScope`, o cast já resolvido pelo enum basta.

**Step 2: Teste que falha**

Adicione em `business-templates.test.ts`:

```ts
it("revenda de veículos captura a CNH completa do comprador (escopo LEAD)", () => {
  const tpl = BUSINESS_TEMPLATES.find((t) => t.id === "revenda-veiculos")!;
  const leadFields = (tpl.customFieldsPreset ?? []).filter((f) => f.scope === "LEAD");
  const labels = leadFields.map((f) => f.label);
  expect(labels).toEqual(
    expect.arrayContaining([
      "Nº da CNH",
      "Categoria da CNH",
      "Validade da CNH",
      "Data de nascimento",
      "Órgão emissor / UF",
      "1ª habilitação",
    ]),
  );
});

it("instruções da revenda blindam a IA de pedir documento no chat", () => {
  const tpl = BUSINESS_TEMPLATES.find((t) => t.id === "revenda-veiculos")!;
  expect(tpl.customInstructions.toLowerCase()).toContain("cnh");
});
```

Run: `npx vitest run src/lib/business-templates.test.ts` → FAIL.

**Step 3: Adicionar os campos LEAD no `revenda-veiculos`**

No `customFieldsPreset` do template (junto dos campos já existentes), acrescente o bloco do comprador:

```ts
      // Comprador (escopo LEAD) — preenchido pelo vendedor no fechamento (CNH completa).
      { scope: "LEAD", label: "Nº da CNH", type: "TEXT" },
      { scope: "LEAD", label: "Categoria da CNH", type: "SELECT", options: ["A", "B", "AB", "C", "D", "E"] },
      { scope: "LEAD", label: "Validade da CNH", type: "DATE" },
      { scope: "LEAD", label: "Data de nascimento", type: "DATE" },
      { scope: "LEAD", label: "Órgão emissor / UF", type: "TEXT" },
      { scope: "LEAD", label: "1ª habilitação", type: "DATE" },
```

> CPF/CNPJ **não** entram aqui — já vêm do cadastro PF/PJ do lead. Não duplique.

**Step 4: Blindar a IA nas instruções**

No `customInstructions` do `revenda-veiculos`, acrescente ao final:

```
 Não peça documentos do cliente (CNH, CPF) pelo WhatsApp — a documentação é coletada presencialmente no fechamento.
```

**Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/business-templates.test.ts` → PASS.

**Step 6: `tsc` limpo + commit**

Run: `npx tsc --noEmit`
```bash
git add src/lib/business-templates.ts src/lib/business-templates.test.ts
git commit -m "feat(veiculos): campos LEAD da CNH do comprador + blindagem da IA no chat"
```

> **Aplicação:** os campos aparecem na ficha do lead (LeadForm/LeadDetailView já renderizam escopo LEAD). Preenchimento é do vendedor; a IA não os coleta. A **Data de nascimento** abre caminho pra automação de aniversário (segue fora de escopo aqui — ler data de custom-field é mais complexo que ler coluna; virá noutra entrega).

---

## Fase B — Automações de agenda e proposta

### Task B.1: Colunas de marcador (schema)

**Files:**
- Modify: `prisma/schema.prisma` (models `Appointment` e `Lead`)

**Step 1: Adicionar as colunas**

No model `Appointment` (perto de `remindedHourBeforeAt`, [schema.prisma:1065](prisma/schema.prisma#L1065)):

```prisma
  // Ciclo de vida da AGENDA: marca o único toque pós-agendamento (pós-visita OU
  // falta — status REALIZADO/FALTOU são exclusivos). Gravado SÓ após enviar.
  lifecycleTouchedAt   DateTime?
```

No model `Lead` (junto de `lastEngagedAt`):

```prisma
  // Follow-up de proposta parada (status OFERTA_ENVIADA). Marcado SÓ após enviar.
  proposalNudgedAt     DateTime?
```

**Step 2: Parar o `next dev`, gerar e aplicar**

Run: `npx prisma db push` (dev local) — depois em PROD entra por migration no build.
Expected: colunas criadas, client regenerado sem erro.

**Step 3: `tsc` limpo + commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(lifecycle): colunas de marcador p/ automacoes de agenda e proposta"
```

### Task B.2: Envs dos novos passes

**Files:**
- Modify: `src/lib/env.ts` (perto de `LIFECYCLE_REENGAGE_DAYS`, [env.ts:124](src/lib/env.ts#L124))

**Step 1: Adicionar ao schema zod**

```ts
  LIFECYCLE_POSTVISIT_HOURS: z.coerce.number().int().nonnegative().default(0), // 0 = off; rec 3
  LIFECYCLE_NOSHOW_HOURS: z.coerce.number().int().nonnegative().default(0),    // 0 = off; rec 2
  LIFECYCLE_PROPOSAL_DAYS: z.coerce.number().int().nonnegative().default(0),   // 0 = off; rec 2
```

**Step 2: `tsc` limpo + commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(lifecycle): envs dos passes de agenda/proposta (default off)"
```

### Task B.3: Textos das novas automações

**Files:**
- Modify: `src/lib/lifecycle.ts`
- Test: `src/lib/lifecycle.test.ts` (crie se não existir)

**Step 1: Teste que falha**

```ts
import { postVisitMessage, noShowMessage, proposalNudgeMessage } from "./lifecycle";

it("renderiza {{nome}} com primeiro nome nas 3 novas automações", () => {
  const lead = { name: "Maria Silva" };
  expect(postVisitMessage(lead)).toContain("Maria");
  expect(noShowMessage(lead)).toContain("Maria");
  expect(proposalNudgeMessage(lead)).toContain("Maria");
});
```

Run: `npx vitest run src/lib/lifecycle.test.ts` → FAIL (funções não existem).

**Step 2: Implementar**

Adicione em `lib/lifecycle.ts` (junto dos `DEFAULT_*` existentes):

```ts
export const DEFAULT_POSTVISIT =
  "Oi, {{nome}}! Que bom te receber hoje 🙌 Como foi? Se surgir qualquer dúvida ou quiser dar o próximo passo, é só chamar!";
export const DEFAULT_NOSHOW =
  "Oi, {{nome}}! Sentimos sua falta no horário de hoje 😊 Quer que eu remarque pra outro dia?";
export const DEFAULT_PROPOSAL =
  "Oi, {{nome}}! Passando pra saber o que achou da proposta que te enviei. Tem alguma dúvida ou quer ajustar algo?";

export const postVisitMessage = (lead: { name: string }) =>
  renderLifecycleTemplate(DEFAULT_POSTVISIT, { nome: firstName(lead.name) });
export const noShowMessage = (lead: { name: string }) =>
  renderLifecycleTemplate(DEFAULT_NOSHOW, { nome: firstName(lead.name) });
export const proposalNudgeMessage = (lead: { name: string }) =>
  renderLifecycleTemplate(DEFAULT_PROPOSAL, { nome: firstName(lead.name) });
```

Run: `npx vitest run src/lib/lifecycle.test.ts` → PASS. Commit.

### Task B.4: Passe de agenda (pós-visita + falta)

**Files:**
- Modify: `src/server/services/lifecycle-automation.ts`
- Test: `src/server/services/lifecycle-automation.test.ts`

**Step 1: Teste de integração que falha**

Casos mínimos (siga o padrão `makeOwner` + criar `Lead` + `Appointment`):
- `Appointment` REALIZADO, `scheduledAt` passou > `LIFECYCLE_POSTVISIT_HOURS`, conta com `lifecycleAutomationEnabled` → envia 1 e grava `lifecycleTouchedAt`.
- `Appointment` FALTOU, passou > `LIFECYCLE_NOSHOW_HOURS` → envia 1 (texto de falta) e grava marcador.
- Já com `lifecycleTouchedAt` setado → não reenvia (idempotente).
- Walk-in (`leadId = null`) → ignorado.
- Conta com `lifecycleAutomationEnabled = false` → ignorado.

> Dica: mocke o envio como os testes atuais fazem (spy em `sendWhatsAppMessage`), controle `now` passando a data ao passe.

Run: FAIL (função não existe).

**Step 2: Implementar `dispatchAppointmentTouch`**

Um passe que varre `Appointment` com `status in [REALIZADO, FALTOU]`, `leadId != null`, `lifecycleTouchedAt: null`, `lead.optOut: false`, `lead.user.lifecycleAutomationEnabled: true`. Para cada um, escolhe atraso+texto pelo status, usa `isDueAfter({ eventAt: scheduledAt, now, delayMs, floorMs, marker: null })`, envia via `sendWhatsAppMessage(lead, msg, { source: "SYSTEM" })` e grava `lifecycleTouchedAt = now` **só após enviar**. `take: BATCH`, `orderBy: { scheduledAt: "asc" }`. Espelhe `dispatchOrderTouch` ([lifecycle-automation.ts:46](src/server/services/lifecycle-automation.ts#L46)). Se `POSTVISIT_HOURS` e `NOSHOW_HOURS` forem ambos 0 → `return 0` no topo (passe desligado).

**Step 3:** Rodar → PASS. Commit.

### Task B.5: Passe de follow-up de proposta + desconflito com reengajamento

**Files:**
- Modify: `src/server/services/lifecycle-automation.ts`
- Test: `src/server/services/lifecycle-automation.test.ts`

**Step 1: Teste que falha**

- Lead `OFERTA_ENVIADA`, engajou (inbound antigo) e esfriou (sem inbound há > `LIFECYCLE_PROPOSAL_DAYS`), sem `proposalNudgedAt` → envia com rodapé opt-out e grava marcador.
- **Desconflito:** o passe de reengajamento **não** deve mais tocar leads `OFERTA_ENVIADA` (evita toque duplo) — teste que um lead OFERTA_ENVIADA frio recebe só o toque de proposta, não os dois.

Run: FAIL.

**Step 2: Implementar `dispatchProposalNudge`**

Clone de `dispatchReengagement` ([lifecycle-automation.ts:121](src/server/services/lifecycle-automation.ts#L121)), com: `status: "OFERTA_ENVIADA"`, cutoff = `LIFECYCLE_PROPOSAL_DAYS`, marcador `proposalNudgedAt`, texto `proposalNudgeMessage`, rodapé opt-out (cold-ish → LGPD). Mesmas travas anti-corrida.

**Step 3: Remover `OFERTA_ENVIADA` do reengajamento**

Em `dispatchReengagement`, trocar `status: { in: ["EM_CONVERSA", "QUALIFICADO", "OFERTA_ENVIADA"] }` por `status: { in: ["EM_CONVERSA", "QUALIFICADO"] }`.

**Step 4:** Rodar → PASS. Commit.

### Task B.6: Registrar os passes no orquestrador

**Files:**
- Modify: `src/server/services/lifecycle-automation.ts` ([dispatchLifecycleAutomations:169](src/server/services/lifecycle-automation.ts#L169))

**Step 1: Teste**

Estenda o teste do orquestrador (se houver) ou confie nos testes de passe. Verifique que com kill-switch off / fora da janela nada dispara (o array novo herda o guard).

**Step 2: Implementar**

No loop, adicionar os 3 passes:

```ts
for (const pass of [
  dispatchPostSale,
  dispatchReviewRequests,
  dispatchReengagement,
  dispatchAppointmentTouch,
  dispatchProposalNudge,
]) { ... }
```

(`dispatchAppointmentTouch` cobre pós-visita **e** falta num passe só.)

**Step 3:** `npx vitest run` (suite inteira) + `npx tsc --noEmit` → verde. Commit.

---

## Verificação end-to-end (antes de anunciar)

1. **Funil:** rodar o onboarding de "Imobiliária" numa conta dev e conferir na tela do funil que os 8 estágios aparecem renomeados ("Visita agendada", "Proposta enviada", "Negócio fechado"…).
2. **Agenda:** com `LIFECYCLE_AUTOMATION=true` + `LIFECYCLE_POSTVISIT_HOURS=3` + conta `lifecycleAutomationEnabled`, criar um `Appointment` REALIZADO com `scheduledAt` ~4h atrás e um lead com chip conectado; rodar um tick do worker e confirmar 1 envio + `lifecycleTouchedAt` gravado. Repetir com FALTOU.
3. **Proposta:** lead `OFERTA_ENVIADA` frio → confirmar 1 nudge e que o reengajamento não o tocou.
4. Rodar `npx vitest run` inteiro + `npx tsc --noEmit`.

## Deploy (quando aprovado)

- **Schema:** as 2 colunas nullable entram por migration aplicada pelo build (torne idempotente `IF NOT EXISTS` se compor manualmente — ver memória `prod-schema-drift-destravar`).
- **Envs (Vercel + worker Oracle):** `LIFECYCLE_POSTVISIT_HOURS`, `LIFECYCLE_NOSHOW_HOURS`, `LIFECYCLE_PROPOSAL_DAYS`. **Sobe inerte** (default 0). Ligar por conta continua sendo `lifecycleAutomationEnabled` + kill-switch global `LIFECYCLE_AUTOMATION`.
- **Worker:** só os passes de agenda/proposta rodam no worker (`dispatchLifecycleAutomations`); atualizar o worker Oracle (`git pull` + `systemctl restart crm-worker`, sem build — ver memória `worker-oracle-update-procedure`).

## Fora de escopo (não faça)

- Múltiplos funis / esteiras separadas por processo (venda × locação).
- Flow builder visual (arrastar nós). Contradiz o posicionamento "a IA age".
- Automação de aniversário. A **captura** do nascimento entra (Task A.2, ramo de veículos), mas o **passe** que dispara a mensagem no aniversário fica pra outra entrega — ler uma data de custom-field é mais complexo que ler uma coluna, e só veículos captura hoje.
- Backfill de rótulos em contas já onboarded.
- Toque de agenda para walk-in sem lead.
- Override de texto por conta.
