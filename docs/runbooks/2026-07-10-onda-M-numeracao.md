# Onda M — Numeração sequencial (pedidos online + agendamentos)

**O que entrega:** "Pedido nº 1, 2, 3…" (cardápio online) e "Agendamento nº 1, 2, 3…"
por conta, atribuídos na **criação** (visíveis desde o PENDENTE / na confirmação),
começando no nº 1 para a primeira conta. Sequências **dedicadas por conta**,
distintas do `Order.number` (cupom do PDV, sai no fechamento).

## Schema (Onda M) — aplicar em PROD ANTES do deploy do código

Aplicar `prisma/manual/2026-07-10-onda-M.sql` no **Supabase SQL Editor** (idempotente,
rodar 2× para conferir). Sem isso, criar pedido/agendamento dá 500 (coluna ausente).

Adiciona:
- `Order.onlineNumber` (Int) + `UNIQUE(accountId, onlineNumber)`
- `Appointment.number` (Int) + `UNIQUE(accountId, number)` (walk-ins; lead-based
  serializado por advisory lock no serviço)

## Como funciona (concorrência)

- Atribuição sob `pg_advisory_xact_lock` por conta: dois pedidos/agendamentos
  simultâneos serializam o `max+1` (sem colisão de número).
- Pedido online: número atribuído na transação de metadados de `placeOnlineOrder`.
- Agendamento: número atribuído em `createAppointment`/`createSeries`; conta efetiva
  = `accountId` (walk-in) OU `lead.userId` (com lead). `confirmBooking` reusa sua
  própria transação (sem transação aninhada).

## Deploy

1. **Schema PROD:** aplicar o SQL acima (idempotente).
2. **Web (Vercel):** deploy do código.
3. **Worker (Oracle):** `git pull` + restart (a confirmação de agendamento por
   WhatsApp usa o novo `number`).

## Retrocompat

- Pedidos/agendamentos **antigos** ficam com número `null` → a UI cai no fallback
  (código curto do id / código cosmético do comprovante). Só os NOVOS recebem o
  sequencial. A contagem começa do maior número existente + 1 (para contas sem
  nenhum, começa no 1).
