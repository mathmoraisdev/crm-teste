# Runbook de deploy — Onda L (Delivery / Cardápio online)

> Iniciativa 15. Checklist para publicar o cardápio online em PROD.
> Todo o código já está em `master`; **nada** deste runbook roda automático no CI —
> o DB de PROD não é alcançável do CI (env Sensitive). Segue o padrão de
> `[[prod-schema-drift-destravar]]` e dos deploys anteriores.

## Pré-condições

- Gate verde local: `npm run test` (971+ testes) e `npm run build` OK.
- Acesso ao Supabase SQL Editor (projeto `sa-east-1`).
- Token de deploy do time `matheus-projects` na Vercel (ver `[[vercel-hobby-push-block]]`).
- Acesso SSH ao worker Oracle (ver `[[worker-oracle-update-procedure]]`).

## 1) Schema em PROD (Onda L)

Aplicar `prisma/manual/2026-07-08-onda-L.sql` no **Supabase SQL Editor**.

- É **idempotente** (`IF NOT EXISTS` / `DO $$ ... duplicate_object`): rodar **2×** e conferir que a 2ª execução não dá erro.
- Sem isso, `/cardapio`, `/pedidos` e `/configuracoes/delivery` dão **500** (colunas/tabelas ausentes).
- **Não** rodar migration versionada redundante (colisão P3018→P3009 trava o deploy). O schema da Onda entra só por este SQL manual.

Cobre: enums `OrderType`/`OrderSource`/`FulfillmentStatus`; colunas de delivery/fulfillment/cobrança online em `Order`; campos de cardápio em `CatalogItem`; `menuEnabled`/`deliveryAddon` em `User`; tabelas `DeliverySettings` e `DeliveryZone`.

## 2) Web (Vercel)

- Deploy do código (`git push` ou CLI com token — `env -u CLAUDECODE CI=1 npx vercel deploy --prod`).
- Conferir env vars: `APP_URL` e `APP_PUBLIC_URL` setadas — o link do cardápio e o do acompanhamento usam. Sem elas, os links saem como `localhost:3000` (ver `[[app-url-vercel-localhost-links]]`).
- Região fixada em `gru1` (São Paulo) via `vercel.json`.

## 3) Worker (Oracle)

- `ssh -i ~/.ssh/oracle-crm ubuntu@136.248.93.142` → `git pull` + `systemctl restart crm-worker` (sem build).
- Necessário porque a **confirmação de pagamento (webhook)** e as **notificações WhatsApp** por status podem rodar no worker.
- Garantir `ENCRYPTION_KEY` no env do worker — `resolvePaymentForUser` decifra a chave BYOK do gateway.

## 4) Por conta (ação do dono)

1. Definir `publicSlug` (mesmo campo do agendamento) se ainda não tiver.
2. Montar o cardápio: itens com `menuVisible` + `menuCategory` no catálogo.
3. Em `/configuracoes/delivery`: criar zonas (bairro + taxa), configurar entrega/retirada/pagamento e horário; ligar **Publicar cardápio** (`menuEnabled`).
4. Para **cobrar online no plano Inicial**: setar `deliveryAddon=true` (painel Financeiro/admin) — ou estar em Profissional+ (já tem `sales`). Ver `[[pricing-plans-cost]]`.
5. Conectar o token do gateway Pix (BYOK) e fazer smoke:
   - Retirada + **pagar na entrega** → Order nasce `ONLINE`/`PENDENTE`, aparece na fila `/pedidos`.
   - Delivery + **pagar online** → pagar Pix sandbox → ver `onlinePaidAt` preenchido e o pedido confirmável na fila.

## 5) Smoke de segurança

- `/cardapio/<slug-inexistente>` → **404**.
- Conta com `menuEnabled=false` → **404** (idêntico a "não existe").
- Pedido abaixo do mínimo (`minOrderCents` da conta ou da zona) → **409**.
- Client tenta enviar `priceCents` falso → ignorado (preço re-snapshotado do servidor).

## Decisões que ficam registradas

- **Pedido online = `Order` real** (não `Sale`). Cobrança mora no `Order`; o webhook ganhou fallback por `(onlineChargeProvider, onlineChargeId)`.
- **Dois ciclos separados:** `status` (financeiro) × `fulfillmentStatus` (operacional). A comanda fecha (`closeOrder` → baixa estoque + fiscal) **ao ENTREGUE**, não antes.
- **Estorno de pedido recusado pago-online:** MVP **não** estorna automático — registra e instrui o dono (a abstração de gateway ainda não tem `refund`).
