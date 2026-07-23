# Rota Clientes + Agendamentos recorrentes — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` para implementar este plano tarefa a tarefa.

**Goal:** Dar ao negócio uma visão de **Cliente** (ficha com histórico de serviços e total gasto, sobre o `Lead` que já existe) e um modelo de **Agendamento** de verdade (N por cliente, com serviço, status e lembrete automático via WhatsApp), para atender casos de recorrência e sessões (ex.: depilação a laser, estética) — "sempre agendado, com compromisso de lembrete e serviço futuro".

**Architecture:** Não cria entidade "cliente" nova — o `Lead` **é** o cliente (já tem `name`, `phone`, `email`, `orders[]`, `tags`, `customFields`). A **Fase 1** entrega a rota `/clientes` como uma _lente_ sobre `Lead`, agregando o histórico de comandas (`Order`) e total gasto — sem mudança de schema. A **Fase 2** cria o modelo `Appointment` (N por `Lead`, ≠ `Meeting` que é 1:1 e semanticamente "reunião de venda"), com serviço opcional (`CatalogItem`), status próprio e **os mesmos lembretes véspera/1h** que o worker já dispara para `Meeting` — reaproveitando o motor de [meeting-reminders.ts](../../src/server/services/meeting-reminders.ts). Agendamentos aparecem na ficha do cliente e na `/agenda`. Séries (pacote de N sessões) são geradas antecipadamente como `Appointment` independentes agrupados por `seriesId`.

**Tech Stack:** Next.js 15 (App Router, route handlers), Prisma 6 + Postgres (Supabase), Zod, React 19, Tailwind, Vitest. Worker Node standalone (loop em `src/server/worker/run.ts`).

---

## Contexto de código (leia antes de começar)

Arquivos-âncora que este plano toca ou espelha:

- Schema: [prisma/schema.prisma](../../prisma/schema.prisma) — `Lead` (L466), `Order` (L280), `OrderItem` (L304), `CatalogItem` (L254), `Meeting` (L622), `MeetingStatus` (enum).
- Serviços: [lead.service.ts](../../src/server/services/lead.service.ts) (`listLeads` L88), [order.service.ts](../../src/server/services/order.service.ts), [meeting.service.ts](../../src/server/services/meeting.service.ts) (`listMeetings` — modelo a espelhar), [meeting-reminders.ts](../../src/server/services/meeting-reminders.ts) (`dueReminder` L26 PURA, `dispatchDueReminders` L102 EFEITO, templates L51/L53).
- Worker: [src/server/worker/run.ts](../../src/server/worker/run.ts) — tick de lembretes em L178-188 (throttle 60s).
- API atual da agenda: [src/app/api/meetings/route.ts] + `AgendaItem` em meeting.service.
- UI: [src/components/AgendaView.tsx](../../src/components/AgendaView.tsx) (agenda; busca por telefone com `phone.replace(/\D/g,"")` L86 — padrão a seguir), [src/components/LeadDetailView.tsx](../../src/components/LeadDetailView.tsx), [src/components/LeadsTable.tsx](../../src/components/LeadsTable.tsx), [src/components/vendas/OrderBoard.tsx](../../src/components/vendas/OrderBoard.tsx).
- Navegação: [src/components/app/Sidebar.tsx](../../src/components/app/Sidebar.tsx) — `navGroups` L102; grupo "Atendimento" tem Painel/Atendimento/Leads (L104-110); "Crescimento" tem Agenda (L115). Ícones de `lucide-react`.
- Mensageria: `sendWhatsAppMessage(lead, texto, { source: "SYSTEM" })` em [messaging.ts](../../src/server/services/messaging.ts) — usa o chip da conversa (`lead.whatsAppNumberId`).
- Tenant/auth: `getTenantContext()` → `{ tenantUserId, sessionUserId, perms }`; `getTenantUserId()` em `@/lib/tenant`.
- Telefone: `normalizePhone`/`formatPhone` em `@/lib/phone`; busca por dígitos já corrigida em `listLeads` (OR com `phone: { contains: digits }`).
- Timezone/format: `env.SCHEDULING_TIMEZONE`, `formatSlot(iso, tz)` em `@/lib/utils`.

### Convenções firmes (não desvie)
- **Multi-tenant:** todo serviço recebe `accountId`/`userId` (= `tenantUserId`) e filtra por ele. `Appointment` NÃO tem `userId` próprio — faz scoping via `lead: { userId }`, exatamente como `Meeting` faz (ver `listMeetings` L23 e `dispatchDueReminders`).
- **Money:** centavos (`Int`), helpers em `@/lib/money`. Total gasto = soma de `OrderItem.unitPriceCents * quantity` de comandas `FECHADA`.
- **Tema:** nunca hex fixo; use utilities de token (`text-ink`, `border-line-default`, `bg-card`, `text-slate-*`, `brand-*`, `mint`/`forest` no sidebar). Ver memória [[design-tokens-dark-theme]].
- **Lembrete idempotente:** só marca `remindedDayBeforeAt`/`remindedHourBeforeAt` APÓS o envio; falha não marca (retry no próximo tick). Copie fielmente o padrão de `dispatchDueReminders`.

### Migrations / PROD (crítico — ver [[prod-schema-drift-destravar]] e [[crm-inbox-db-push-pending]])
- **Dev:** pare o `next dev` antes de qualquer `prisma generate`/`migrate` (lock de DLL no Windows — [[prisma-generate-dev-server-lock]]).
- **Fase 2 muda schema.** Gere migration versionada: `npx prisma migrate dev --name appointments`. Depois `npx prisma generate`.
- **PROD (Supabase):** o cutover p/ `migrate deploy` nunca concluiu — toda tabela/coluna nova exige rodar o SQL manual no SQL Editor senão dá 500. Portanto: **inclua o SQL bruto idempotente** (`CREATE TABLE IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object`) em `prisma/manual/2026-07-<dd>-appointments.sql`, no mesmo estilo dos arquivos existentes em [prisma/manual/](../../prisma/manual/). É o que efetivamente destrava PROD.

### Padrão de teste (Vitest) — o repo tem DOIS estilos; use o certo por caso
- Rodar tudo: `npm test`. Um arquivo: `npx vitest run caminho/arquivo.test.ts`.
- **Lógica pura → import direto** (ex.: `meeting-reminders.test.ts` testa `dueReminder`/`renderReminderTemplate`). Use para a decisão de lembrete do agendamento.
- **Integração com banco real** — `makeOwner()` cria dono descartável; exercita o serviço real com FK. Use para `appointment.service` (criar/listar/série, scoping por lead.userId). Requer `DATABASE_URL` de teste.
- **Prisma mockado** — `vi.mock("@/server/db/client")`. Use se for só montagem de `where`.
- **NÃO recrie** `meeting-reminders.test.ts` — ele é o molde; crie `appointment-reminders.test.ts` no mesmo estilo.
- Commits em pt-BR, um por tarefa (`feat(clientes): ...`, `feat(agenda): ...`).

---

# FASE 1 — Rota `/clientes` (ficha + histórico, sem schema novo)

**Resultado:** um item "Clientes" no menu abre uma lista de clientes (= `Lead`) com nome, telefone, última visita e total gasto; clicar abre a ficha com o histórico de comandas. Cadastro manual de serviço para cliente existente = abrir comanda já vinculada (fluxo que já existe no Caixa).

### Tarefa 1.1 — Serviço `listClientes` + `getClienteHistory`
- Em `lead.service.ts` (ou novo `cliente.service.ts` que reusa `Lead`): `listClientes(userId, { query, skip, take })` retornando `{ id, name, phone, lastOrderAt, totalSpentCents, orderCount }`.
- Agregação: `Order` do lead com `status: "FECHADA"`, somando itens. Prefira 1 query com `_count`/`groupBy` ou `include` enxuto — evite N+1. Ordene por `lastOrderAt desc`.
- Reutilize a busca por dígitos já aplicada em `listLeads` (não duplique lógica de telefone).
- `getClienteHistory(userId, leadId)` → comandas do lead (abertas e fechadas) com itens, mais recente primeiro. Scoping por `userId`.
- **Teste (banco real):** cria dono, lead, 2 comandas fechadas com itens → assere `totalSpentCents`/`orderCount`; confirma que comanda de outro dono não vaza.

### Tarefa 1.2 — API `/api/clientes`
- `GET /api/clientes?q=&skip=&take=` → `listClientes`. `getTenantContext()`, 401 se ausente. Respeite `leadsScope === "ASSIGNED"` (só os atribuídos), espelhando [api/leads/route.ts](../../src/app/api/leads/route.ts) L12-14.
- `GET /api/clientes/[id]` → `getClienteHistory`.

### Tarefa 1.3 — UI `/clientes` (lista + ficha)
- Rota `src/app/(app)/clientes/page.tsx` (Server Component fino, igual `agenda/page.tsx`) → renderiza `<ClientesView />`.
- `ClientesView`: busca com debounce (input digita nome OU telefone com máscara — a busca por dígitos já casa), tabela com nome, telefone `formatPhone`, última visita (`relativeDayLabel` reaproveitável de AgendaView), total gasto (`formatMoney`). Loading via `LoadingBlock`.
- Ficha: pode reusar/estender `LeadDetailView` OU um painel próprio; mostre **Histórico de serviços** (comandas + itens + valor). Botão "Nova comanda" leva ao Caixa pré-vinculado (passar `leadId`).
- **Tema:** só tokens. Sem hex.

### Tarefa 1.4 — Item "Clientes" no Sidebar
- Em `Sidebar.tsx` `navGroups`, grupo "Atendimento": adicione `{ href: "/clientes", label: "Clientes", icon: UsersRound }` (ou `Contact` de lucide) após "Leads". `Leads` = funil/CRM; `Clientes` = ficha/histórico — deixe claro que são lentes distintas do mesmo `Lead`.

---

# FASE 2 — Modelo `Appointment` (agendamento recorrente + lembrete)

**Resultado:** na ficha do cliente e na `/agenda`, dá pra agendar um serviço futuro (data/hora + serviço opcional + observação); o worker envia lembrete véspera/1h ao cliente no WhatsApp; sessões repetidas (pacote) são geradas de uma vez.

### Tarefa 2.1 — Schema `Appointment` + enum + migration + SQL manual
- Model (N por lead; sem `userId` próprio — scoping por `lead.userId`):
  ```prisma
  enum AppointmentStatus { AGENDADO CONFIRMADO REALIZADO FALTOU CANCELADO }

  model Appointment {
    id                   String            @id @default(cuid())
    lead                 Lead              @relation(fields: [leadId], references: [id], onDelete: Cascade)
    leadId               String
    catalogItem          CatalogItem?      @relation(fields: [catalogItemId], references: [id], onDelete: SetNull)
    catalogItemId        String?
    serviceName          String?           // snapshot do serviço (sobrevive a exclusão do item)
    scheduledAt          DateTime
    status               AppointmentStatus @default(AGENDADO)
    note                 String?
    seriesId             String?           // agrupa sessões de um mesmo pacote
    order                Order?            @relation(fields: [orderId], references: [id], onDelete: SetNull)
    orderId              String?           // comanda gerada quando REALIZADO
    remindedDayBeforeAt  DateTime?
    remindedHourBeforeAt DateTime?
    createdById          String
    createdBy            User              @relation(fields: [createdById], references: [id])
    createdAt            DateTime          @default(now())
    updatedAt            DateTime          @updatedAt

    @@index([leadId, scheduledAt])
    @@index([seriesId])
    @@index([status, scheduledAt])
  }
  ```
- Adicione as relações inversas em `Lead` (`appointments Appointment[]`), `CatalogItem`, `Order`, `User`.
- `npx prisma migrate dev --name appointments` && `npx prisma generate` (dev server parado).
- **PROD:** crie `prisma/manual/2026-07-<dd>-appointments.sql` idempotente (enum via `DO $$ … EXCEPTION WHEN duplicate_object`, `CREATE TABLE IF NOT EXISTS`, índices `IF NOT EXISTS`, FKs em blocos `DO $$`), espelhando o estilo do hotfix de destravar. FKs: `leadId`→Lead CASCADE, `catalogItemId`→CatalogItem SET NULL, `orderId`→Order SET NULL, `createdById`→User RESTRICT.

### Tarefa 2.2 — Serviço `appointment.service.ts`
- `createAppointment(userId, { leadId, scheduledAt, catalogItemId?, serviceName?, note?, createdById })` — valida que o `leadId` pertence a `userId` (`lead.userId === userId`), snapshota `serviceName` do `CatalogItem` se veio `catalogItemId` e `serviceName` vazio.
- `createSeries(userId, base, { everyDays, count })` — gera `count` agendamentos com `seriesId` compartilhado (cuid), somando `everyDays` a cada um. Cobre "10 sessões, uma por semana". `count` limitado (ex.: ≤ 52).
- `listAppointments(userId, { from?, to?, leadId?, status? })` — scoping por `lead: { userId }`, `include` do lead (`id,name,phone`) e `catalogItem`. Ordena por `scheduledAt asc`.
- `updateAppointment` / `cancelAppointment` / `markRealized(id, { orderId? })`.
- **Teste (banco real):** criar/listar/scoping; `createSeries` gera N com mesmo `seriesId` e datas espaçadas.

### Tarefa 2.3 — Lembretes no worker (espelha `meeting-reminders`)
- Novo `appointment-reminders.ts`: **reutilize `dueReminder`** (é PURA, serve igual) e escreva `dispatchDueAppointmentReminders(now)` no molde de `dispatchDueReminders` (L102-172):
  - `where`: `status: { in: ["AGENDADO","CONFIRMADO"] }`, `scheduledAt: { gt: now }`, `OR` de reminded null.
  - Texto: default próprio de **serviço** (não "conversa") — ex.: `DEFAULT_APPT_REMINDER_DAY_BEFORE = "Oi, {{nome}}! Lembrete do seu {{servico}} amanhã.\n📅 {{quando}}\nAté lá! 😊"`. Reaproveite `renderReminderTemplate` (adicione placeholder `{{servico}}`, mantendo `{{link}}` opcional/vazio) — ou uma variante paralela. Sem link.
  - `sendWhatsAppMessage(appt.lead, texto, { source: "SYSTEM" })`; marca timestamp só após enviar.
- **Teste puro:** `dueReminder` já coberto; teste a renderização do template de serviço (`{{servico}}` preenchido e ausente).

### Tarefa 2.4 — Plugar no tick do worker
- Em `run.ts`, dentro do bloco de lembretes (L180-188), após `dispatchDueReminders`, chame `dispatchDueAppointmentReminders(new Date())` no mesmo throttle de 60s; log separado (`"[worker] lembretes de agendamento enviados"`). Try/catch próprio — falha de um não derruba o outro.

### Tarefa 2.5 — API `/api/appointments`
- `GET /api/appointments?from=&to=&leadId=&status=` → `listAppointments`.
- `POST /api/appointments` (Zod: `leadId`, `scheduledAt` ISO, `catalogItemId?`, `serviceName?`, `note?`, `series?: { everyDays, count }`) → `createAppointment` ou `createSeries`. `createdById = ctx.sessionUserId`.
- `PATCH /api/appointments/[id]` (status/reagendar), `DELETE` (cancelar).

### Tarefa 2.6 — UI: agendar na ficha + mostrar na Agenda
- **Ficha do cliente (Fase 1.3):** seção "Agendamentos" — próximos primeiro, com status (Badge: AGENDADO âmbar, CONFIRMADO verde, REALIZADO cinza, FALTOU/CANCELADO vermelho). Botão "Agendar" abre modal: data/hora, serviço (select do catálogo, opcional), observação, e toggle "repetir" → everyDays + count (pacote). Botão "Marcar realizado" (opcional: abre comanda pré-vinculada e grava `orderId`).
- **Agenda (`AgendaView`):** una `Meeting` + `Appointment` num só fluxo, OU acrescente uma aba/filtro "Agendamentos". Reaproveite `relativeDayLabel`/`formatSlot`/busca por telefone. Mínimo aceitável: agendamentos aparecem na `/agenda` com nome do cliente + serviço + horário.
- **Tema:** só tokens.

---

## Fora de escopo (Fase 3, só se um cliente real pedir)
- **Pacote/plano formal** (`Package`: N sessões contratadas, saldo consumido, valor do pacote) — hoje um pacote é só uma série de `Appointment` com `seriesId`. Formalizar saldo/faturamento do pacote é um módulo à parte.
- **Recorrência infinita** (regra tipo "toda quinta pra sempre") — a série antecipada com `count` já cobre os casos reais (pacotes finitos).
- **Google Calendar** — decisão consciente de agenda in-system ([[agenda-in-system-reminders]]).
