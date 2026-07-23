# Auto-agendamento online — o cliente marca sozinho por um link público

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Documento-pai:** `docs/plans/2026-07-05-roadmap-multinegocio.md` (iniciativa 8, Onda F, Release 4).

**Goal:** hoje toda marcação nasce **dentro** do sistema — um operador logado cria o `Appointment`
na ficha do cliente ou na tela da Agenda. Este plano abre um **link público sem login**
(`/agendar/<slug-da-conta>`) onde o próprio cliente escolhe **serviço → profissional → horário
livre** e confirma, respeitando **duração por serviço**, **expediente** e **conflito** — reusando o
motor da Agenda Pro (iniciativa 5, já em PROD). A confirmação cria um **lead leve** (ou walk-in) e um
`Appointment` pelo **mesmo serviço** que a UI interna usa, e o **lembrete sai pelo fluxo já
existente** (worker). Nenhuma linha do fluxo autenticado muda de comportamento.

**Architecture:** o coração é um **motor de disponibilidade PURO** em `src/lib/agenda/availability.ts`
(mesma biblioteca da Agenda Pro, sem DB): dado o expediente do dia (`WorkingHours`), a duração do
serviço, um passo de grade e os intervalos ocupados, ele **deriva os horários livres**. Um serviço
fino (`booking-availability.service`) monta esses insumos do banco — reusando `WorkingHours`,
`conflictsFor` e os snapshots de duração que **já existem** — e devolve os slots. A **página pública**
(`/agendar/[slug]`, server component fora do grupo `(app)`) resolve a conta pelo `publicSlug`, herda
o **branding da conta** (`getBranding` + `<BrandingStyle>`, igual o layout autenticado faz) e embute
um widget cliente de seleção. A **confirmação** (POST público) revalida o slot e chama o **mesmo**
`createAppointment` do fluxo interno — então conflito/expediente continuam sendo barrados no serviço,
não na borda. Tudo público entra pela allowlist do `middleware.ts` e passa por `rateLimit`.

**Tech Stack:** Next.js (App Router, Next 15 async params) · Prisma · Postgres · Zod · TailwindCSS ·
Intl.DateTimeFormat (TZ) · Vitest.

**Escopo (o que NÃO entra em v1):**
- **Pagamento/sinal no ato do agendamento** — v1 só marca; cobrança segue pelo fluxo de oferta/Pix ou
  no caixa. Pré-pagamento de sinal é follow-up.
- **Booking sem profissional** — a disponibilidade v1 é **por profissional** (janela do profissional −
  agendamentos do profissional, reusando `conflictsFor`). Conta que **não modela `Professional`** não
  usa agendamento online no v1 (limitação documentada; "expediente padrão sem pessoa" não tem contra o
  quê checar conflito de forma bem-definida).
- **Opt-in fino por serviço/profissional** — v1 oferece **todos** os `Professional` ativos e **todos**
  os `CatalogItem SERVICO` ativos com `durationMinutes > 0`. Esconder item/pro específico do link é
  follow-up (uma coluna `bookable Boolean` por item/pro).
- **Reagendar/cancelar pelo link** (o cliente mexer no que marcou) — v1 só cria. Cancelamento continua
  pelo operador ou pela resposta ao lembrete (`decideApptTransition`, já existe).
- **ReCAPTCHA/antifraude pesado** — v1 protege com `rateLimit` por IP+slug; captcha é follow-up.

**Decisões de produto:**
- **Opt-in por conta** (`bookingEnabled`, default `false`) — nada muda pra quem não liga. Ligar exige
  ter ao menos um `Professional` ativo com expediente e um serviço com duração.
- **Slug estável e legível** — `publicSlug` por conta (`@unique`), derivado do `appName`/nome na
  ativação, editável nas Configurações. Sem slug ⇒ link não existe (404).
- **Lead leve preferido, walk-in como piso** — confirmar cria um lead leve (`consentSource:
  "public_booking"`) ligado ao chip primário da conta **para o lembrete funcionar**; se a conta não
  tem chip ou está no teto de contatos, cai para **walk-in** (`customerName/customerPhone`, sem lembrete).
- **`createdById` = dono da conta** — não há usuário logado no fluxo público; o agendamento é "criado
  pela própria conta em autoatendimento". Auditoria fica clara (não inventa um "system user").
- **Slot só é ofertado se cabe inteiro** no expediente, respeita o intervalo, está **livre** e depois
  da **antecedência mínima** (`bookingLeadMinutes`). Granularidade = `bookingSlotStep` (grade).
- **Conflito é a fonte da verdade no serviço** — o link nunca "reserva" fora do `createAppointment`;
  se dois clientes disputam o mesmo slot, o serviço barra (com guarda anti-corrida na Fase 5).

---

## Coordenação (Onda F — compartilhada com a iniciativa 9, Comissão)

- **Schema (Onda F):** este plano cria **`prisma/manual/2026-07-09-onda-f.sql`** (idempotente,
  `IF NOT EXISTS`) com o que a iniciativa 8 precisa (colunas em `User`: `publicSlug` + toggles/config
  de booking). A **iniciativa 9** (`2026-07-09-comissao.md`) **acrescenta** `CommissionRule` +
  `OrderItem.commissionCents` ao **mesmo** arquivo — **não sobrescreva, compõe** (igual estoque×despesas
  na Onda A e flag×MediaAsset na Onda E). Deixe um comentário de cabeçalho declarando o compartilhamento.
- **Depende de Onda C (Agenda Pro) já em PROD** ([[agenda-pro-feito]]): `Professional`, `WorkingHours`,
  `CatalogItem.durationMinutes`, `Appointment.professionalId/durationMinutes/customerName/customerPhone`
  **já existem** e estão deployados (`onda-c.sql` aplicado). Este plano **não** toca nesses models —
  só **lê** deles e adiciona colunas em `User`.
- Regra de ouro da Onda ([[prod-schema-drift-destravar]]): em dev é `db push` (pare o `next dev` —
  [[prisma-generate-dev-server-lock]]); em PROD é **só** o `manual/*.sql` idempotente aplicado pelo dono
  no Supabase SQL Editor. **Nunca** rode SQL manual redundante com uma migration versionada.
- Sem sobreposição de arquivos de código com a iniciativa 9 (ela vive em `order.service`/relatórios;
  esta, em `availability.ts`, um serviço de booking novo, uma rota pública nova e Settings).

---

## Contexto do código existente (leia antes de começar)

- **Motor puro da agenda:** [availability.ts](../../src/lib/agenda/availability.ts) — já tem
  `appointmentEnd`, `overlaps`, `isWithinWorkingHours(slotStartMin, slotEndMin, DayWindow[])` e
  `localWeekdayAndMinutes(date, tz)` (Date → `{weekday, minuteOfDay}` no fuso). **Falta o inverso**
  (hora-de-parede local → `Date` UTC) e o gerador de slots — é o que a Fase 2 adiciona **aqui**.
- **Serviço de agendamento:** [appointment.service.ts](../../src/server/services/appointment.service.ts)
  — `createAppointment(userId, input)` ([:279](../../src/server/services/appointment.service.ts#L279))
  já aceita walk-in (`customerName/customerPhone`, `leadId` opcional), snapshota nome+duração, valida
  `assertProfessionalOwned` e `assertSlotFree` (conflito **CONFLICT:** / expediente **OUTSIDE_HOURS:**).
  `conflictsFor(accountId, professionalId, start, end, exceptId?)`
  ([:205](../../src/server/services/appointment.service.ts#L205)) devolve os agendamentos ativos que
  sobrepõem — **reuse na Fase 3**. `loadWorkingWindows`/`isOutsideWorkingHours` são **privados**
  ([:155](../../src/server/services/appointment.service.ts#L155)) — a Fase 3 precisa de um leitor de
  janelas exportado (ou espelha a query via `professional.service`).
- **Grade de expediente:** [professional.service.ts](../../src/server/services/professional.service.ts)
  — `listProfessionals(accountId, {activeOnly})`, `listWorkingHours(accountId, professionalId|null)`
  ([:164](../../src/server/services/professional.service.ts#L164)). `WorkingHours` guarda minutos desde
  00:00; `professionalId null` = expediente **padrão** da conta (fallback).
- **Catálogo:** `listCatalogItems(accountId, {activeOnly})` — filtre `kind==="SERVICO"` e
  `durationMinutes>0` para os serviços agendáveis.
- **Lead:** [`createLead`](../../src/server/services/lead.service.ts#L192) `(userId, name, rawPhone,
  rawEmail?, extra?)` — dedupe manual por `(userId, phone)`, `assertContactQuota`, `normalizePhone`
  ([phone.ts:10](../../src/lib/phone.ts#L10)). O inbound orgânico usa `resolveOrCreateLead`
  ([conversation.service.ts:166](../../src/server/services/conversation.service.ts#L166)) que grava
  `whatsAppNumberId` (necessário p/ o lembrete ter chip). A `@@unique([whatsAppNumberId, phone])`
  ([schema.prisma:680](../../prisma/schema.prisma#L680)) dedupa por número.
- **Lembrete:** [appointment-reminders.ts](../../src/server/services/appointment-reminders.ts) —
  `dispatchDueAppointmentReminders` roda no worker, envia véspera/1h **só** para agendamentos com
  `leadId != null` (walk-in não recebe). Nada a mudar: se o booking criar lead com chip, o lembrete
  sai sozinho.
- **Branding público:** `getBranding(tenantUserId)` ([branding.service.ts:40](../../src/server/services/branding.service.ts#L40))
  → `{palette, appName, logoUrl, presetId}` com defaults seguros; `<BrandingStyle palette={...}/>`
  ([BrandingStyle.tsx:7](../../src/components/app/BrandingStyle.tsx#L7)) injeta as CSS vars no `:root`
  (sem flash). O `(app)/layout` faz exatamente isso; a página pública repete **sem auth**. Tokens/CSS
  vars, nunca hex ([[design-tokens-dark-theme]]).
- **Molde de página pública SSR:** [recibo/[orderId]/page.tsx](../../src/app/recibo/%5BorderId%5D/page.tsx)
  — `dynamic="force-dynamic"`, `params: Promise<...>`, `try/catch → notFound()`. Copiar **trocando**
  `getTenantContext()` por o resolver de slug.
- **Molde de rota pública:** [api/consultant/route.ts](../../src/app/api/consultant/route.ts) —
  `// PÚBLICO (sem auth)`, `runtime="nodejs"`, zod, JSON com status; **não** chama `getTenantContext`.
  A porta pública é a **allowlist** do [middleware.ts:16](../../src/middleware.ts#L16) (`PUBLIC_PREFIXES`);
  o `matcher` já ignora assets. `rateLimit(key, limit, windowSec)` em
  [ratelimit.ts:21](../../src/lib/ratelimit.ts#L21) (degrada p/ "sempre ok" sem Redis).
- **Base URL:** `env.APP_URL` ([env.ts:81](../../src/lib/env.ts#L81)) monta o link público absoluto;
  `env.SCHEDULING_TIMEZONE` ([:37](../../src/lib/env.ts#L37)) é o fuso dos slots. Flags: `z.coerce.boolean().default(false)`.
- **Tenancy:** conta = `User` dono (`ownerId=null`); `publicSlug` mora no `User` (identidade de
  roteamento, sempre presente, independente de branding cosmético).

---

## Visão geral das fases

> **Ordem por dependência de dados, não pela numeração do mestre.** O motor puro (Fase 2) não depende
> de nada e é o mais testável; a escrita pública (Fase 5) é a mais arriscada e vem por último. Cada
> fase é entregável e reversível (a rota pública só "existe" quando entra na allowlist na Fase 3).

- **Fase 1** — Onda F: `User.publicSlug` + opt-in `bookingEnabled` + config de slot; serviço de slug;
  Settings UI (ligar booking, editar slug, copiar link). Nada público ainda.
- **Fase 2** — Motor de disponibilidade **PURO** (TDD): hora-de-parede→UTC, varredura de dias no fuso,
  geração de slots livres. Sem DB.
- **Fase 3** — Serviço `booking-availability` (monta insumos do banco, reusa `conflictsFor`/`WorkingHours`)
  + endpoint público de slots + allowlist no middleware + `rateLimit`.
- **Fase 4** — Página pública `/agendar/[slug]` (branding herdado) + widget de seleção serviço/pro/dia.
- **Fase 5** — Confirmação: POST público → lead leve/walk-in + `createAppointment` + mensagem de
  confirmação + guarda anti-corrida; lembrete pelo worker existente.
- **Fase 6** — Verificação E2E + rollout PROD.

---

# FASE 1 — Onda F: slug, opt-in e config (sem nada público ainda)

Objetivo: dar à conta uma identidade pública (`publicSlug`) e o botão de liga/desliga, tudo nas
Configurações. Nenhuma rota pública existe ainda — só schema, serviço e UI interna.

## Task 1.1: Colunas de booking em `User` (Onda F)
**Files:** Modify `prisma/schema.prisma` (`User`); Create `prisma/manual/2026-07-09-onda-f.sql`.
- Em `User`, junto dos campos de personalização de conta (`pipelineLabels`, `inboxSlaMinutes`):
```prisma
  publicSlug         String?  @unique // link público de agendamento; null = sem link
  bookingEnabled     Boolean  @default(false) // opt-in do auto-agendamento online
  bookingLeadMinutes Int      @default(120) // antecedência mínima p/ marcar (min)
  bookingHorizonDays Int      @default(30)  // janela futura ofertada (dias)
  bookingSlotStep    Int      @default(15)  // granularidade da grade de horários (min)
```
- `db push` em dev (pare o `next dev` — [[prisma-generate-dev-server-lock]]). `npx prisma validate`.
- `onda-f.sql` idempotente com cabeçalho de compartilhamento (a iniciativa 9 **acrescenta** aqui):
```sql
-- Onda F (idempotente). Iniciativa 8 (agendamento online): slug público + config de booking.
-- Iniciativa 9 (comissão) ACRESCENTA CommissionRule + OrderItem.commissionCents neste mesmo
-- arquivo — não sobrescreva, compõe (padrão da Onda A/E). [[prod-schema-drift-destravar]]
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "publicSlug" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingLeadMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingHorizonDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingSlotStep" INTEGER NOT NULL DEFAULT 15;
-- @unique do Prisma vira índice único; nulos são distintos no Postgres (contas sem slug coexistem).
CREATE UNIQUE INDEX IF NOT EXISTS "User_publicSlug_key" ON "User"("publicSlug");
```
- Commit.

## Task 1.2: `booking-settings.service` — slug + config (TDD)
**Files:** Create `src/server/services/booking-settings.service.ts`; Test co-locado.
- **PURA** `slugify(raw): string` — minúsculas, ASCII, hífens, sem borda de hífen; vazio → `""`.
  Testes: acentos/espaços/símbolos → slug limpo; string vazia → `""`.
- `getBookingSettings(accountId)` → `{ publicSlug, bookingEnabled, bookingLeadMinutes,
  bookingHorizonDays, bookingSlotStep }`.
- `setBookingSettings(accountId, patch)` — valida com zod: `bookingLeadMinutes>=0`,
  `bookingHorizonDays 1..180`, `bookingSlotStep 5..120`. Slug: `slugify` + **unicidade** (`findFirst`
  por `publicSlug` de outra conta → erro legível "Esse endereço já está em uso."). Slug vazio após
  slugify → erro. Escopo por conta.
- `ensureSlug(accountId)` — se a conta ainda não tem `publicSlug`, gera de `appName`/nome (via
  `slugify`), resolvendo colisão com sufixo curto (`-2`, `-3`…). Idempotente (já tem → devolve o atual).
- Testes: set/patch respeitam limites; slug duplicado barra; `ensureSlug` gera único e não sobrescreve.
  Commit.

## Task 1.3: API de configurações de booking
**Files:** Create `src/app/api/booking-settings/route.ts` (GET + PATCH).
- Espelha o padrão de settings (`dynamic="force-dynamic"`, `getTenantContext` → 401, **403 sem
  `canSettings`**, zod, try/catch → 400). GET devolve settings + o **link absoluto**
  (`${env.APP_URL}/agendar/${publicSlug}`) quando há slug. PATCH aplica `setBookingSettings`; ao ligar
  `bookingEnabled` sem slug, chama `ensureSlug` antes. Commit.

## Task 1.4: UI — seção "Agendamento online" nas Configurações
**Files:** Create `src/components/app/BookingSettings.tsx`; Modify `src/app/(app)/configuracoes/page.tsx`.
- Switch "Agendamento online" (liga `bookingEnabled`); campo de slug editável com preview do link e
  botão **copiar**; campos de antecedência mínima / janela (dias) / granularidade. Aviso inline quando
  a conta **não tem** profissional ativo com expediente OU serviço com duração ("Cadastre um
  profissional com horário e um serviço com duração para liberar o link"). Só tokens/CSS vars
  ([[design-tokens-dark-theme]]). Verificação visual + commit.

> **Fim da Fase 1:** a conta liga o booking e vê seu link, mas abrir o link ainda dá 404 (a rota
> nasce na Fase 4, liberada no middleware na Fase 3). Zero impacto em produção.

---

# FASE 2 — Motor de disponibilidade (PURO, TDD)

Objetivo: **derivar horários livres** sem tocar no banco. Tudo em
[availability.ts](../../src/lib/agenda/availability.ts), ao lado do que a Agenda Pro já pôs lá. Estas
funções são o que mais precisa de teste (fuso, grade, borda de expediente) e o que menos muda.

## Task 2.1: Hora-de-parede local → `Date` UTC (inverso de `localWeekdayAndMinutes`) — TDD
**Files:** Modify `src/lib/agenda/availability.ts`; Test `availability.test.ts`.
- `zonedWallTimeToUtc(year, month, day, minuteOfDay, timeZone): Date` — dado um "relógio de parede"
  local (ano/mês/dia + minuto do dia) **naquele fuso**, retorna o instante `Date` (UTC) correspondente.
  Algoritmo: chute `Date.UTC(...)`, mede o offset do fuso naquele instante via `Intl.DateTimeFormat`
  (formatToParts), corrige; **re-mede e re-corrige uma vez** (segurança em transição de DST). *(America/
  Sao_Paulo não tem mais DST, mas a função fica correta p/ qualquer fuso — não hardcode −03:00.)*
- **Round-trip é a invariante de teste:** para vários `(dia, minuto, fuso)`,
  `localWeekdayAndMinutes(zonedWallTimeToUtc(...), fuso)` devolve o mesmo `minuteOfDay` e o weekday
  esperado. Testes: 09:00 em `America/Sao_Paulo` cai no instante UTC certo; meia-noite (minuto 0);
  fuso `UTC` (offset zero); um fuso com DST (ex.: `America/New_York`) num dia normal. Commit.

## Task 2.2: Varredura de dias-calendário no fuso — TDD
**Files:** Modify `availability.ts`; Test.
- `enumerateLocalDates(fromUtc, toUtc, timeZone): { year; month; day; weekday }[]` — lista os
  dias-calendário **do fuso** cujo início (00:00 local) cai no intervalo `[fromUtc, toUtc]`. Usa
  `Intl` p/ obter ano/mês/dia/weekday locais e caminha de 24h em 24h com normalização (não confia em
  aritmética ingênua de fuso). Cobre a "janela futura" do booking (`bookingHorizonDays`).
- Testes: intervalo de 3 dias → 3 (ou 4) entradas com weekday correto; virada de mês; começa/termina
  no meio do dia. Commit.

## Task 2.3: Geração de slots livres do dia — TDD
**Files:** Modify `availability.ts`; Test.
- `computeDaySlots(opts): Date[]` — puro. `opts`:
```ts
interface DaySlotOpts {
  date: { year: number; month: number; day: number }; // dia-calendário local
  timeZone: string;
  windows: DayWindow[];        // expediente do dia (reusa DayWindow já existente)
  busy: { start: Date; end: Date }[]; // ocupados (UTC) do profissional nesse dia
  durationMinutes: number;     // duração do serviço (>0)
  stepMinutes: number;         // grade (bookingSlotStep)
  notBefore: Date;             // piso de antecedência (agora + bookingLeadMinutes), UTC
}
```
  Para cada janela, gera inícios candidatos de `startMinute` até `endMinute - duration`, de
  `stepMinutes` em `stepMinutes`; converte cada candidato via `zonedWallTimeToUtc`; **mantém** o slot
  sse: cabe inteiro na janela e fora do intervalo (reusa `isWithinWorkingHours` p/ o par
  `[slotStartMin, slotStartMin+duration]`), `slotStart >= notBefore`, e **não** sobrepõe nenhum `busy`
  (reusa `overlaps` com `appointmentEnd`). Ordena crescente e dedup entre janelas.
- Testes (a jóia da coroa): janela 09:00–12:00, serviço 60min, passo 30 → 09:00/09:30/10:00/10:30/11:00;
  um `busy` 10:00–11:00 remove 09:30/10:00/10:30; intervalo 12:00–13:00 numa janela 09:00–18:00 não
  oferta slot que o atravesse; `notBefore` 10:15 corta os anteriores; sem janela → `[]`; duração que
  não cabe na janela → `[]`. Commit.

> **Fim da Fase 2:** dado expediente + ocupados + duração, o sistema sabe listar os horários livres,
> 100% testável, sem DB. `npx vitest run src/lib/agenda`.

---

# FASE 3 — Serviço de disponibilidade + endpoint público de slots

## Task 3.1: Leitor de janelas de expediente reutilizável (TDD)
**Files:** Modify `src/server/services/professional.service.ts` (exporta um resolvedor de janelas);
Test.
- Exporte `resolveWorkingWindows(accountId, professionalId, weekday): Promise<DayWindow[]>` — a mesma
  regra que hoje é privada em `appointment.service` (`loadWorkingWindows`): prioriza a grade **própria**
  do profissional no `weekday`; se vazia, cai no **padrão** da conta (`professionalId null`); vazio =
  sem expediente. *(Extrair p/ um único dono evita duplicar a query; `appointment.service` pode passar
  a consumir este também, mas isso é refactor opcional — o essencial é a Fase 3 ter um leitor público.)*
- Testes: profissional com grade própria; fallback p/ padrão; dia sem expediente → `[]`. Commit.

## Task 3.2: `booking-availability.service` — monta e delega (TDD)
**Files:** Create `src/server/services/booking-availability.service.ts`; Test co-locado.
- `listBookableServices(accountId)` → `CatalogItem` `SERVICO` ativos com `durationMinutes>0`
  (`id, name, priceCents, durationMinutes`).
- `listBookableProfessionals(accountId)` → `Professional` ativos (`id, name, color`).
- `getAvailableSlots(accountId, { catalogItemId, professionalId, fromUtc, toUtc })`:
  1. resolve o serviço (posse + `durationMinutes`; sem duração → erro legível);
  2. resolve os profissionais-alvo: um específico (valida posse) **ou todos os ativos** quando
     `professionalId` ausente ("sem preferência");
  3. carrega os agendamentos **ativos** (`AGENDADO/CONFIRMADO`) desses profissionais na janela
     `[fromUtc, toUtc]` **uma vez** (query por range), agrupa por profissional e por dia — reusa a
     lógica de `conflictsFor` (na verdade, chame `conflictsFor` por dia/profissional **ou** faça a
     query de range e monte os `busy` com `appointmentEnd`; prefira a query de range p/ não fazer N
     roundtrips);
  4. para cada profissional × cada dia (`enumerateLocalDates`), resolve as janelas
     (`resolveWorkingWindows`) e chama `computeDaySlots`;
  5. devolve slots como `{ startISO, professionalId, professionalName }[]` ordenados; no modo "sem
     preferência", **deduplica por horário** guardando o primeiro profissional livre (o confirm decide).
  - `notBefore = new Date(now + bookingLeadMinutes*60000)`; `fromUtc/toUtc` limitados a
    `bookingHorizonDays` (a borda decide o range; o serviço só respeita o teto).
- Testes com prisma de teste: serviço 60min + profissional com expediente 09–12 e um agendamento
  10–11 → slots esperados; dois profissionais no modo "sem preferência" → união deduplicada por
  horário; serviço sem duração → erro; profissional de outra conta → erro. Commit.

## Task 3.3: Endpoint público de slots + allowlist + rate limit
**Files:** Create `src/app/api/agendar/[slug]/slots/route.ts`; Modify `src/middleware.ts`.
- **Middleware:** adicione `"/agendar"` e `"/api/agendar"` a `PUBLIC_PREFIXES`
  ([middleware.ts:16](../../src/middleware.ts#L16)) — a regra `startsWith(p + "/")` cobre slug e
  subcaminhos. Comentário explicando que é o link público de autoatendimento.
- **Rota** (`runtime="nodejs"`, `dynamic="force-dynamic"`, **sem** `getTenantContext`):
  1. `rateLimit("booking:slots:"+ip+":"+slug, N, 60)` — 429 ao estourar;
  2. resolve a conta por `publicSlug` **e** `bookingEnabled=true` (`prisma.user.findUnique`); ausente
     ou desligado → 404 (não vaza existência da conta);
  3. lê `catalogItemId`, `professionalId?`, `date` (ou `from/to`) da query; deriva `fromUtc/toUtc` do
     `date` no fuso, respeitando `bookingLeadMinutes`/`bookingHorizonDays`;
  4. `getAvailableSlots(...)`; devolve `{ slots }` (nunca dados sensíveis da conta — só nome/cor do
     profissional e o horário). Erros → 400 com mensagem curta.
- Commit.

> **Fim da Fase 3:** `GET /api/agendar/<slug>/slots?...` responde horários livres publicamente, com
> rate limit, sem expor nada além do necessário. Ainda sem página nem escrita.

---

# FASE 4 — Página pública `/agendar/[slug]` (branding herdado)

## Task 4.1: Página SSR que resolve a conta e herda o branding
**Files:** Create `src/app/agendar/[slug]/page.tsx` (server component, **fora** do grupo `(app)`);
Create `src/app/agendar/[slug]/not-found.tsx` (opcional, mensagem amigável).
- Molde do [recibo](../../src/app/recibo/%5BorderId%5D/page.tsx): `dynamic="force-dynamic"`,
  `params: Promise<{slug:string}>`. Resolve a conta por `publicSlug`+`bookingEnabled`; ausente →
  `notFound()`. Carrega `getBranding(accountId)` + `listBookableServices` + `listBookableProfessionals`.
  Renderiza `<BrandingStyle palette={branding.palette} />` no topo (CSS vars da conta, sem flash),
  cabeçalho com `logoUrl`/`appName`, e monta o widget cliente (Task 4.2) com os serviços/profissionais
  já embutidos. Sem serviço/profissional agendável → estado vazio amigável ("Agendamento indisponível
  no momento"). `metadata` com o `appName` da conta. Commit.

## Task 4.2: Widget de agendamento (client component)
**Files:** Create `src/components/agendar/BookingWidget.tsx` (+ subcomponentes se precisar).
- Passos: **serviço** → **profissional** (com opção "Sem preferência") → **dia** (próximos
  `bookingHorizonDays`, respeitando a antecedência) → **horário** (busca
  `/api/agendar/<slug>/slots?...` ao escolher dia/serviço/pro; loading/empty states) → **dados**
  (nome + telefone, com máscara/normalização visual) → **confirmar** (POST da Fase 5). Estados de
  erro (429 "muitas tentativas", 409 "esse horário acabou de ser preenchido" → recarrega slots).
  Mobile-first, só tokens/CSS vars ([[design-tokens-dark-theme]]). Verificação visual + commit.

> **Fim da Fase 4:** o link abre uma página com a cara da conta e lista horários reais; o botão
> confirmar ainda não grava (Fase 5).

---

# FASE 5 — Confirmação: lead leve/walk-in + `createAppointment` + lembrete

## Task 5.1: Resolver "lead leve" público (TDD)
**Files:** Modify `src/server/services/lead.service.ts` (novo helper); Test.
- `resolveOrCreatePublicLead(accountId, { name, phone })`:
  1. `normalizePhone(phone)` (lança "telefone inválido" → a borda vira 400);
  2. escolhe o **chip primário** da conta (primeiro `WhatsAppNumber` conectado; senão qualquer; senão
     nenhum) p/ o lembrete ter por onde sair;
  3. dedupe: se há chip, `findFirst` por `(whatsAppNumberId, phone)`; senão por `(userId, phone)`;
     achou → devolve (atualiza `name` se estava só o telefone);
  4. **teto de contatos**: se `assertContactQuota(accountId)` barra, **não** cria lead — sinaliza ao
     chamador que deve cair para walk-in (retorna `null` ou lança um erro tipado `QUOTA`);
  5. cria lead leve: `name`, `phone`, `whatsAppNumberId` (do chip, se houver), `status:"NOVO"`,
     `consentSource:"public_booking"`.
- Testes (stubs de quota/prisma): cria com chip quando há; dedupa por `(numberId, phone)`; sem chip
  dedupa por `(userId, phone)`; quota estourada → sinal de walk-in (sem criar lead). Commit.

## Task 5.2: `confirmBooking` no serviço (TDD)
**Files:** Modify `src/server/services/booking-availability.service.ts`; Test.
- `confirmBooking(accountId, { catalogItemId, professionalId, startISO, customerName, customerPhone })`:
  1. revalida: conta `bookingEnabled`, serviço agendável (duração), `startISO` **>= notBefore** e
     **<= horizonte** (defesa contra POST fora da UI);
  2. **guarda anti-corrida (decisão firme):** envolve a checagem+criação numa transação com
     `pg_advisory_xact_lock(hashtext(professionalId || startISO))` (`prisma.$transaction` +
     `$executeRaw`), de modo que dois confirms simultâneos no mesmo slot serializem — o segundo vê o
     conflito e recebe **CONFLICT:**. *(O caminho interno tem a mesma corrida latente; aqui é crítico
     porque são estranhos disputando — por isso a trava mora no confirm público.)*
  3. resolve o cliente: `resolveOrCreatePublicLead` → lead leve (com chip) **ou** walk-in
     (`customerName/customerPhone`) quando não há lead (sem chip / quota);
  4. `createAppointment(accountId, { leadId? , customerName?, customerPhone?, scheduledAt,
     catalogItemId, professionalId, createdById: accountId })` — **sem** `allowOverlap`/`force`: o
     serviço barra conflito/expediente (o cliente não fura fila). Erro **CONFLICT:/OUTSIDE_HOURS:**
     propaga p/ a borda virar 409;
  5. se criou lead com chip, dispara **mensagem de confirmação** via `sendWhatsAppMessage(lead, texto,
     {source:"SYSTEM"})` (texto tipo "Agendamento confirmado: {{servico}} em {{quando}} 😊"); walk-in
     sem chip não recebe (igual lembrete). O lembrete véspera/1h sai depois pelo worker
     (`dispatchDueAppointmentReminders`) sem código novo.
- Testes: confirma cria `Appointment` ligado ao lead leve; slot ocupado → CONFLICT (não cria);
  fora do horizonte → erro; walk-in quando conta sem chip; envia confirmação só quando há chip. Commit.

## Task 5.3: Endpoint público de confirmação
**Files:** Create `src/app/api/agendar/[slug]/route.ts` (POST).
- Público (allowlist já cobre `/api/agendar`), `runtime="nodejs"`, `dynamic="force-dynamic"`.
  `rateLimit("booking:confirm:"+ip+":"+slug, N, 60)` → 429. Resolve conta por slug+`bookingEnabled`
  (senão 404). Zod: `catalogItemId`, `professionalId?` (opcional; "sem preferência" resolve no
  serviço p/ o 1º livre), `startISO` (datetime), `customerName` (min 1), `customerPhone` (min).
  Chama `confirmBooking`; mapeia **CONFLICT:/OUTSIDE_HOURS:** → 409 com `kind` (a UI recarrega slots),
  quota/validação → 400, sucesso → 201 `{ ok:true }` (não devolve dados internos do agendamento).
  Commit.

## Task 5.4: Fechar o loop na UI
**Files:** Modify `src/components/agendar/BookingWidget.tsx`.
- Confirmar → POST; 201 → tela de sucesso ("Tudo certo, {{nome}}! Seu horário está marcado para
  {{quando}}."); 409 → aviso "esse horário acabou de ser preenchido" + recarrega os slots do dia;
  429 → "muitas tentativas, tente em instantes". Verificação E2E local + commit.

---

# FASE 6 — Verificação de ponta a ponta + rollout

## Task 6.1: Verificação E2E (dev)
1. Configurações → ligar "Agendamento online"; conferir slug gerado e copiar o link.
2. Cadastrar profissional com expediente (09–18, almoço 12–13) e serviço "Corte" 30min.
3. Abrir o link (aba anônima): a página tem a **cor/nome da conta**; escolher Corte → profissional →
   um dia → horários coerentes (sem 12:xx que atravesse o almoço; sem passado; respeitando a
   antecedência).
4. Confirmar com nome+telefone → sucesso; conferir na **Agenda interna** que o `Appointment` apareceu
   com o profissional/serviço/horário e um **lead leve** ligado (ou walk-in se a conta não tem chip).
5. Marcar internamente algo no mesmo horário e voltar ao link → aquele slot **sumiu**; tentar confirmar
   um slot que acabou de ser tomado (dois navegadores) → o segundo recebe **409** e recarrega.
6. Conta com `bookingEnabled=false` ou slug inexistente → **404**. Conta ligada mas **sem** profissional
   com expediente → estado vazio (não 500).
7. `npx vitest run src/lib/agenda src/server/services/booking-availability.service.test.ts
   src/server/services/booking-settings.service.test.ts src/server/services/lead.service.test.ts`
   verde + `npx tsc --noEmit`.

## Task 6.2: Rollout PROD
- Aplicar **`2026-07-09-onda-f.sql`** no Supabase SQL Editor (idempotente; **não** duplicar com
  migration versionada — [[prod-schema-drift-destravar]]). Se a iniciativa 9 já tiver composto o
  arquivo, aplicar o arquivo inteiro (as partes são todas `IF NOT EXISTS`).
- Deploy web via CLI com token do time ([[vercel-hobby-push-block]]); o worker (Oracle) **não** muda
  (lembrete reusa o tick existente — mas `git pull` + restart não faz mal — [[worker-oracle-update-procedure]]).
- Ligar o booking em **uma** conta de teste, validar o link em produção (branding + slot real +
  confirmação chegando como lead/lembrete), só então liberar para clientes.

---

## Riscos e notas

- **Corrida de slot público** — dois estranhos podem confirmar o mesmo horário quase juntos; a checagem
  `conflictsFor` isolada é TOCTOU. **Resolvido na Task 5.2** com `pg_advisory_xact_lock` no confirm
  (serializa por `professionalId+startISO`); o segundo recebe 409 e a UI recarrega. O caminho interno
  mantém a corrida latente (baixa probabilidade, operador vê) — fora do escopo mexer nele aqui.
- **Fuso é a maior fonte de bug** — todo slot nasce de "hora de parede" no `SCHEDULING_TIMEZONE`.
  `zonedWallTimeToUtc` é puro e tem round-trip nos testes; **nunca** hardcode `-03:00` (embora
  Sao_Paulo não tenha mais DST, a função é geral). O confirm revalida `startISO` no serviço — a borda
  não confia no relógio do cliente.
- **Enumeração de contas via slug** — 404 idêntico para "não existe" e "existe mas booking off" evita
  sondar quais contas usam o produto. `rateLimit` por IP+slug freia brute-force de slug.
- **Teto de contatos** — booking público poderia estourar a cota criando leads. Decisão (Task 5.1):
  ao bater no teto, **cai para walk-in** (agenda mesmo assim, sem virar contato/CRM nem lembrete) em
  vez de falhar a marcação — o operador converte depois. Não fura `assertContactQuota`.
- **Lembrete precisa de chip** — só o lead leve **ligado a um `WhatsAppNumber`** recebe véspera/1h
  (o worker já exige `leadId != null` e o `sendWhatsAppMessage` exige chip). Walk-in sem chip agenda
  mas não é lembrado — coerente com o comportamento atual de walk-in ([[agenda-pro-feito]]).
- **Depende de Agenda Pro (Onda C)** — este plano **lê** `Professional/WorkingHours/durationMinutes`
  e reusa `createAppointment/conflictsFor`. Se a Agenda Pro não estivesse em PROD, este plano não teria
  chão; ela está ([[agenda-pro-feito]]).
- **Onda F compartilhada com a iniciativa 9** — respeitar o **append** no `onda-f.sql`; nunca duplicar
  manual×migration ([[prod-schema-drift-destravar]]).
- **Sem Storage local não bloqueia** — a página usa `logoUrl` só se existir; o essencial (slots,
  confirmação) não depende de Storage ([[local-dev-db-docker]]).
</content>
</invoke>
