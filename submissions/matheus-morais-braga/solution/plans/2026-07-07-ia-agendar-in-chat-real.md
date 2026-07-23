# IA: agendar in-chat REAL (Agenda Pro) + oferecer o link

Data: 2026-07-07

## Objetivo

Quando o cliente quiser marcar pela conversa, a IA oferece **dois caminhos**:
1. **"Marcar aqui mesmo"** — propõe horários REAIS da Agenda Pro e cria um
   `Appointment` de verdade (profissional/serviço/expediente), igual ao link público.
2. **"Pelo link"** — envia a URL `/agendar/<slug>` (mesmo destino, autoatendimento).

Hoje a tool `agendar` cai no fluxo antigo de **`Meeting`** via `getCalendar()` (mock por
padrão) — desconectado da Agenda Pro. Este plano religa o in-chat na Agenda Pro real.

## Fronteira de escopo (o que NÃO muda)

- O caminho do **funil de qualificação** (`qualifyEnabled` → `nextAction=schedule_meeting`,
  score ≥ 70) continua no fluxo `Meeting`/`proposeSlots` atual. É outro caso de uso
  (SDR marcando uma *reunião de venda*, não um serviço). Fora deste escopo.
- **Sem mudança de schema.** Reaproveito o registro `Meeting` (1:1 com lead, já usado
  como store da proposta pendente). O `proposedSlots` (`Json`) passa a guardar objetos
  ricos quando a proposta é de Agenda Pro; um discriminador de forma separa os fluxos.

## Mudanças

### 1. Contexto injetado para a IA
`src/server/ai/attendance-context.ts`
- Nova função pura `renderBookingContext({ services, professionals, bookingUrl })` →
  bloco `AGENDAMENTO`:
  - serviços agendáveis (`id | nome | preço | duração`) — fonte: `listBookableServices`
  - profissionais (`id | nome`) — fonte: `listBookableProfessionals`
  - linha do link público, se houver (`Link de autoatendimento: <url>`)
- Omitido inteiro quando não há serviço agendável e não há link.

`src/server/services/conversation.service.ts` (caminho agêntico, ~L699)
- Quando `scheduleEnabled`: carregar `listBookableServices(accountId)`,
  `listBookableProfessionals(accountId)` e o `publicSlug`/`bookingEnabled` do dono
  (`lead.userId`). Montar `bookingUrl = ${APP_URL}/agendar/${slug}` (só se
  `bookingEnabled && slug`). Passar o bloco ao prompt e os ids às tools.

### 2. Tool `agendar` reescrita
`src/server/ai/tools/attendance-tools.ts`
- Assinatura passa a receber `{ serviceId: string, professionalId?: string }`
  (ids vindos do bloco `AGENDAMENTO`). `professionalId` ausente = sem preferência.
- Handler chama `proposeAppointmentSlots(ctx.lead.id, ctx.accountId, {serviceId, professionalId})`
  e encerra o turno (`stop:true`).
- Gate de registro: `scheduleEnabled && bookableServices.length > 0`
  (mantém a regra `!qualifyEnabled` para não duplicar disparo com o funil).
- `AttendanceToolCtx` ganha `bookableServices` (para validar/gate). Validação dura
  fica no serviço (mensagem legível se serviço/profissional inválido).

### 3. Serviço do agendamento in-chat
`src/server/services/appointment-chat.service.ts` (novo) — reusa a Agenda Pro:
- `proposeAppointmentSlots(leadId, accountId, {serviceId, professionalId?})`:
  - `getAvailableSlots(accountId, {catalogItemId, professionalId, fromUtc=now, toUtc=horizon})`,
    pega os **3 primeiros**.
  - 0 horários → mensagem de fallback ("não achei horário; se preferir, veja pelo link: <url>")
    e não cria proposta.
  - `Meeting.upsert` `{status: PROPOSED, proposedSlots: [{startISO, professionalId,
    professionalName, serviceId, serviceName}]}` (objetos = discriminador).
  - envia WhatsApp numerado ("1) … 2) … 3) …").
- `interpretAndBookAppointment(leadId, message)`:
  - carrega `Meeting` PROPOSED com `proposedSlots` **em forma de objeto**;
  - `interpretSlotChoice` (reusa a IA existente) → índice escolhido;
  - `confirmBooking(accountId, {catalogItemId, professionalId, startISO,
    customerName: lead.name, customerPhone: lead.phone})` (mesma trava anti-corrida
    e criação do link público). `confirmBooking` já manda a confirmação p/ lead com
    chip → **não** duplicar mensagem aqui.
  - sucesso → `Meeting` CONFIRMED (encerra a proposta). `CONFLICT:` → repropõe.
  - não muda `lead.status` (REUNIAO_AGENDADA é do funil de venda; aqui é serviço).

### 4. Dispatch da resposta pendente
`src/server/services/conversation.service.ts` (~L546, branch `meeting.status === "PROPOSED"`)
- Ler `proposedSlots`; se os itens forem **objetos** → `interpretAndBookAppointment`;
  se forem **strings** (fluxo antigo) → `interpretAndBook` atual. Preserva retrocompat.

### 5. Prompt
`src/server/ai/prompts.ts` (`ATTENDANCE_SYSTEM`)
- Acrescentar orientação: ao querer agendar, a IA pode (a) **marcar aqui** chamando
  `agendar` com o `serviceId` (e `professionalId` se o cliente escolheu), ou (b) mandar
  o **link** do bloco AGENDAMENTO. Se o cliente não indicou preferência, perguntar
  ("posso marcar aqui mesmo ou te mando o link?"). Nunca inventar id nem horário.

## Testes
- `attendance-tools.test.ts`: nova assinatura + gate (`scheduleEnabled && services>0`,
  ainda `!qualifyEnabled`).
- `appointment-chat.service.test.ts` (novo): propõe (3 slots, mock de `getAvailableSlots`),
  confirma (chama `confirmBooking`), 0 slots → fallback, CONFLICT → repropõe.
- dispatch: `proposedSlots` objeto → rota nova; string → rota antiga.

## Riscos / notas
- Blast radius no core de conversa: manter o caminho antigo byte-idêntico quando
  `proposedSlots` é string; feature nova só entra sob `scheduleEnabled` + tools ligadas.
- Sem serviço agendável mas com link → não registra `agendar`; ainda injeta o link
  para a IA compartilhar.
- Deploy: só código (sem SQL). Não altera PROD schema.
