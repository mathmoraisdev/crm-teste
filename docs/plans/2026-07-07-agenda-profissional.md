# Agenda Pro — profissional/recurso + duração por serviço + calendário + conflito

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 5, Onda C).

**Goal:** hoje a Agenda é uma **lista** que **não sabe qual profissional atende** nem **quanto dura**
cada serviço — o que inviabiliza operar a agenda cheia da maioria dos ramos (barbearia, salão,
clínica, estética, fisio, personal…). Este plano adiciona: **profissional/recurso** no agendamento,
**duração por serviço**, **horário de funcionamento estruturado**, **detecção de conflito** (sem
dupla marcação do mesmo profissional), **visão calendário** (dia/semana) e criar agendamento **na
própria tela da Agenda** (hoje só na ficha do cliente). É o **maior destravador do lado serviços**.

**Architecture:** novo model `Professional` (por conta, opcionalmente ligado a um membro da equipe).
`Appointment.professionalId` opcional (agendamentos antigos ficam sem). Duração vem de
`CatalogItem.durationMinutes` e é **snapshotada** em `Appointment.durationMinutes` (igual o
`serviceName` já é — reajustar o catálogo não altera agendamento antigo); o fim é derivado
(`scheduledAt + durationMinutes`). `WorkingHours` (por profissional/conta) estrutura o expediente;
a validação de slot e a **detecção de conflito** são **funções puras** testáveis, aplicadas no
serviço ao criar/editar. A visão calendário reusa a `AgendaView` (lista continua como fallback/mobile).

**Tech Stack:** Next.js (App Router) · Prisma · Postgres · Zod · TailwindCSS · Vitest.

**Escopo (o que NÃO entra):** auto-agendamento pelo cliente (link público = iniciativa 8, depende
desta); comissão (iniciativa 9, depende desta); múltiplas salas/equipamentos como recurso distinto de
pessoa (v1 = `Professional` cobre pessoa e recurso genérico); reserva parcial/overbooking configurável
(v1 bloqueia conflito, sem override).

**Decisões de produto:**
- **Profissional é opcional** — quem não usa (ex.: serviço sem pessoa fixa) não é forçado; o campo
  fica em branco e nada quebra. Liga por conta/uso, sem poluir quem não precisa.
- **Duração opcional** — sem `durationMinutes`, o agendamento é um instante (comportamento atual);
  com, ganha fim, conflito e blocos no calendário.
- **Conflito bloqueia por padrão** (mesmo profissional, janelas sobrepostas), mas o serviço aceita
  `allowOverlap` explícito (encaixe consciente) — não travar o operador que sabe o que faz.
- **Snapshot de duração/serviço** no `Appointment` — histórico imutável.

---

## Coordenação (Onda C — Agenda; pode rodar em paralelo com Inbox/Onda D)

- **`prisma/schema.prisma`** + **novo `prisma/manual/2026-07-07-onda-c.sql`** — só esta iniciativa
  toca a Onda C; sem merge com outros planos. `npx prisma validate` após as mudanças.
- Independe de POS/Caixa (Release 1). **É pré-requisito** de Agendamento online (8) e Comissão (9).

---

## Contexto do código existente (leia antes de começar)

- **Model:** [schema.prisma:672-698](../../prisma/schema.prisma#L672-L698) — `Appointment` (`leadId`,
  `catalogItemId`, `serviceName` snapshot, `scheduledAt`, `status`, `seriesId`, `needsReview`,
  `createdById`); [660-666](../../prisma/schema.prisma#L660-L666) — `AppointmentStatus`;
  [255-278](../../prisma/schema.prisma#L255-L278) — `CatalogItem` (ganha `durationMinutes`).
- **Serviço:** [appointment.service.ts](../../src/server/services/appointment.service.ts) —
  `createAppointment`/`createSeries` (~89-147), `resolveServiceName` (~62-77, o padrão de snapshot a
  espelhar p/ duração), `updateAppointment`/`cancelAppointment`/`markRealized` (~211-269),
  `listAppointments` (~173, orderBy `scheduledAt asc`), `loadOwned` (~137).
- **API:** [appointments/route.ts:44-77](../../src/app/api/appointments/route.ts#L44-L77),
  `appointments/[id]/route.ts`.
- **UI criação:** [AppointmentSection.tsx](../../src/components/clientes/AppointmentSection.tsx) —
  `ScheduleModal` (~157-301, `datetime-local` + select de serviço + série), botões de status (~103-135).
- **UI agenda:** [AgendaView.tsx](../../src/components/AgendaView.tsx) — lista (não calendário), abas
  Reuniões/Agendamentos (~61-64,160-179), filtro AGENDADO/CONFIRMADO (~129), filtro de revisão
  (~275-291). O empty state manda ir à ficha do cliente (~305) — some quando 5.6 permitir criar aqui.
- **Lembretes:** [appointment-reminders.ts](../../src/server/services/appointment-reminders.ts) — usa
  `lead` p/ telefone; walk-in sem lead não recebe lembrete (tratar na Fase 6).
- **Equipe:** já existe conceito de membros da conta (`User.ownerId`, rota `/equipe`) — `Professional`
  pode **opcionalmente** referenciar um `User` membro, mas não exige (profissional pode não ter login).
- **PROD drift** ([[prod-schema-drift-destravar]]): models/colunas novas → SQL idempotente Onda C.

---

## Visão geral das fases

- **Fase 1** — `Professional` (model + serviço + CRUD/API + UI em Configurações) + `Appointment.professionalId`.
- **Fase 2** — `CatalogItem.durationMinutes` + snapshot em `Appointment` + fim derivado.
- **Fase 3** — `WorkingHours` + validação de slot dentro do expediente (puro).
- **Fase 4** — Detecção de conflito (puro + serviço).
- **Fase 5** — Visão calendário (dia/semana por profissional) + criar na tela da Agenda.
- **Fase 6** — Walk-in (agendamento sem lead) — opcional/última.

Cada fase é entregável e reversível.

---

# FASE 1 — Profissional

## Task 1.1: Model `Professional` + `Appointment.professionalId` (Onda C)
**Files:** Modify `prisma/schema.prisma`; Create `prisma/manual/2026-07-07-onda-c.sql`.
```prisma
model Professional {
  id           String        @id @default(cuid())
  accountId    String
  account      User          @relation("ProfessionalAccount", fields: [accountId], references: [id], onDelete: Cascade)
  name         String
  active       Boolean       @default(true)
  color        String        @default("slate") // chave de Tone p/ o calendário
  userId       String?       // vínculo opcional a um membro da equipe (login); null = só nome
  appointments Appointment[]
  workingHours WorkingHours[]
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  @@index([accountId, active])
}
```
- Em `Appointment`: `professionalId String?` + relação; índice `@@index([professionalId, scheduledAt])`.
- Relação inversa no `User` (`professionals`). push dev (pare o `next dev` — [[prisma-generate-dev-server-lock]]).
- `onda-c.sql` idempotente: `CREATE TABLE IF NOT EXISTS "Professional" (...)`, `ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "professionalId" TEXT`, índices `IF NOT EXISTS`. Commit.

## Task 1.2: `professional.service` (CRUD, TDD)
**Files:** Create `src/server/services/professional.service.ts`; Test co-locado.
- `listProfessionals(accountId, { activeOnly? })`, `createProfessional`, `updateProfessional`,
  `deactivateProfessional` (soft — não apaga p/ preservar histórico de agendamentos). Escopo por conta.
  Testes de posse/escopo + soft-delete. Commit.

## Task 1.3: API + UI de profissionais (Configurações)
**Files:** Create `src/app/api/professionals/route.ts` + `[id]/route.ts`; Create
`src/components/app/ProfessionalsSettings.tsx`; Modify `configuracoes/page.tsx`.
- Rotas espelham `catalog/[id]` (force-dynamic, `getTenantContext`, 401, **403 sem `canSettings`**,
  zod). UI: lista + adicionar (nome, cor, vínculo opcional a membro) + ativar/desativar. Commit.

## Task 1.4: Selecionar profissional no agendamento
**Files:** Modify `AppointmentSection.tsx` (`ScheduleModal`); Modify `appointment.service.ts`
(`createAppointment`/`createSeries` aceitam `professionalId`); Modify `appointments/route.ts` (zod).
- Select de profissional (ativos) no modal. Serviço grava `professionalId`. Teste + commit.

---

# FASE 2 — Duração por serviço

## Task 2.1: `CatalogItem.durationMinutes` + `Appointment.durationMinutes` (Onda C)
**Files:** Modify `schema.prisma`; append `onda-c.sql`; Modify `CatalogManager.tsx` (campo duração no
item de serviço).
- `CatalogItem.durationMinutes Int?`; `Appointment.durationMinutes Int?`. push + SQL idempotente.
  UI: campo "Duração (min)" ao cadastrar/editar item `SERVICO`. Commit.

## Task 2.2: Snapshot de duração + fim derivado (TDD)
**Files:** Modify `appointment.service.ts`; Test.
- Ao criar, se `durationMinutes` não vier explícito, copia do `CatalogItem` (snapshot — espelha
  `resolveServiceName`). Helper puro `appointmentEnd(scheduledAt, durationMinutes)` (null → instante).
  Teste do snapshot + do fim. Commit.

---

# FASE 3 — Horário de funcionamento

## Task 3.1: Model `WorkingHours` (Onda C)
**Files:** Modify `schema.prisma`; append `onda-c.sql`.
```prisma
model WorkingHours {
  id             String       @id @default(cuid())
  accountId      String
  professionalId String?      // null = expediente padrão da conta
  professional   Professional? @relation(fields: [professionalId], references: [id], onDelete: Cascade)
  weekday        Int          // 0=domingo … 6=sábado
  startMinute    Int          // minutos desde 00:00 (ex.: 540 = 09:00)
  endMinute      Int
  breakStart     Int?         // intervalo (almoço) opcional
  breakEnd       Int?
  @@index([accountId, professionalId, weekday])
}
```
- push + SQL idempotente. Commit.

## Task 3.2: Validação de slot dentro do expediente (PURO, TDD)
**Files:** Create `src/lib/agenda/availability.ts`; Test.
- `isWithinWorkingHours(slotStart, slotEnd, hoursForWeekday)` — respeita início/fim e o intervalo.
  Testes: dentro/fora, cavalgando o almoço, dia sem expediente. Commit.

## Task 3.3: UI de expediente + aplicar na criação
**Files:** Modify `ProfessionalsSettings.tsx` (grade de horários por profissional/padrão); Modify
`appointment.service.ts` (avisa/bloqueia fora do expediente — decisão: **avisa** e deixa criar com
`force`, não trava dinheiro nem encaixe). Commit.

---

# FASE 4 — Detecção de conflito

## Task 4.1: `overlaps` + `findConflicts` (PURO + query, TDD)
**Files:** Modify `src/lib/agenda/availability.ts` (puro) e `appointment.service.ts` (query); Test.
- Puro `overlaps(aStart, aEnd, bStart, bEnd)` (bordas tocando ≠ conflito). Query
  `conflictsFor(accountId, professionalId, start, end, exceptId?)` — busca agendamentos ativos
  (`AGENDADO`/`CONFIRMADO`) do mesmo profissional que se sobrepõem. Testes do puro + integração. Commit.

## Task 4.2: Bloquear conflito no create/update (TDD)
**Files:** Modify `appointment.service.ts`; Modify `appointments/route.ts` + `[id]/route.ts`.
- `createAppointment`/`updateAppointment` chamam `conflictsFor`; se houver e não vier `allowOverlap`,
  lançam erro legível ("Profissional já tem agendamento nesse horário"). Teste do bloqueio + do override.
  API devolve 409 com a mensagem. Commit.

## Task 4.3: UI trata o conflito
**Files:** Modify `AppointmentSection.tsx`.
- Ao receber 409, mostra o conflito e oferece "encaixar mesmo assim" (`allowOverlap`). Commit.

---

# FASE 5 — Visão calendário

## Task 5.1: Endpoint de agenda por dia/semana
**Files:** Modify `appointment.service.ts` (`listAppointments` aceita `from`/`to` + `professionalId`);
Modify `appointments/route.ts`.
- Range de datas + filtro por profissional; retorna `professionalId`, `durationMinutes`, `serviceName`,
  `status`. Teste + commit.

## Task 5.2: Grade de calendário (dia/semana por profissional)
**Files:** Modify `AgendaView.tsx`; Create `src/components/agenda/CalendarGrid.tsx`.
- Eixo de horas × colunas de profissional (dia) ou × dias (semana); blocos posicionados por
  `scheduledAt`+duração, cor do profissional (tokens — [[design-tokens-dark-theme]]). Alternador
  Lista/Dia/Semana. A **lista** atual permanece como fallback (mobile). Verificação visual + commit.

## Task 5.3: Criar agendamento na tela da Agenda
**Files:** Modify `AgendaView.tsx`; reusar o `ScheduleModal`.
- Botão "Novo agendamento" e/ou clique num slot vazio abre o modal já com data/hora/profissional
  pré-preenchidos. Some o empty state que mandava ir à ficha. Verificação E2E + commit.

---

# FASE 6 — Walk-in (agendamento sem lead) — opcional

## Task 6.1: `Appointment` sem lead obrigatório (Onda C)
**Files:** Modify `schema.prisma` (`leadId String?` + `customerName String?` + `customerPhone String?`);
append `onda-c.sql`; ajustar todos os pontos que assumem `lead` não-nulo.
- **Blast radius:** lembretes precisam de telefone → sem lead, usar `customerPhone` (ou pular o
  lembrete se ausente). Auditar `appointment-reminders.ts`, `AgendaView`, `AppointmentSection`. push +
  SQL idempotente (`ALTER COLUMN "leadId" DROP NOT NULL`, add colunas). Testes de walk-in. Commit.

## Task 6.2: UI de walk-in
**Files:** Modify `AppointmentSection.tsx`/`AgendaView.tsx`.
- Modo "sem cadastro" (só nome + telefone opcional), igual comanda avulsa. Commit.

---

## Verificação de ponta a ponta

1. Cadastrar 2 profissionais com cores e expedientes diferentes.
2. Serviço "Coloração" com 120min; agendar com o profissional A → bloco de 2h no calendário.
3. Agendar B no mesmo horário → OK (profissional diferente). Agendar A de novo sobreposto → **409**,
   com opção de encaixe.
4. Agendar fora do expediente → aviso, cria com `force`.
5. Visão Dia/Semana mostra blocos coloridos por profissional; criar direto na grade funciona.
6. (Fase 6) Walk-in sem cadastro agenda; sem telefone não dispara lembrete.
7. `npx vitest run src/lib/agenda src/server/services/appointment.service.test.ts src/server/services/professional.service.test.ts`
   verde + `npx tsc --noEmit`.
8. PROD: aplicar `2026-07-07-onda-c.sql`; abrir `/agenda` e `/configuracoes` sem 500.

---

## Riscos e notas

- **Retrocompat:** `professionalId`/`durationMinutes` opcionais — agendamentos antigos seguem
  funcionando como instante sem profissional. Nada de backfill obrigatório.
- **`needsReview` com múltiplos agendamentos** ([[agenda-in-system-reminders]]): com profissional +
  horário distintos, a resposta ao lembrete fica menos ambígua — considerar melhorar a heurística de
  `interpretAppointmentReply` aqui (fora do escopo estrito, mas anotar).
- **Conflito é bloqueio suave** (aceita `allowOverlap`) — encaixe é realidade de salão/barbearia.
- **Walk-in (Fase 6)** tem blast radius nos lembretes — por isso é a última e opcional; sem ela, a
  Agenda Pro já entrega tudo pra quem trabalha com cliente cadastrado.
- **PROD:** models/colunas na Onda C idempotente; `DROP NOT NULL` (Fase 6) é seguro e idempotente
  (checar se já é nullable). Não duplicar com migration versionada ([[prod-schema-drift-destravar]]).
