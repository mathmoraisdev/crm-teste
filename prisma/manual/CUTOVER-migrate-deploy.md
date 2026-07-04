# Cutover para `prisma migrate deploy` em produção

**Objetivo:** parar de aplicar schema em prod na mão (SQL no Supabase) e passar a
aplicar via `prisma migrate deploy` automaticamente no build. Isso elimina o drift
que causou os 500 em série de 2026-07-04 (login, branding, catálogo).

> ⚠️ Operação sensível (mexe no histórico de migrations de PROD). Faça em janela de
> baixo tráfego, com backup/snapshot do banco à mão. Rode os comandos `prisma`
> localmente apontando para PROD via env — eles NÃO tocam no seu banco de dev.

---

## Diagnóstico (por que está quebrado)

1. O build **já** roda migrate deploy: `package.json` →
   `"build": "prisma generate && prisma migrate deploy && next build"`.
2. Mas o **histórico de migrations estava 2 mudanças atrás do schema**: ninguém
   gerou migration para `User.businessTemplateId` nem para `CatalogItem/Order/OrderItem`
   — foram aplicados só via `prisma/manual/*.sql`. Sem migration, `migrate deploy`
   nunca cria essas tabelas → 500.
3. Prod foi historicamente populado por `prisma db push` + SQL manual, então a
   tabela `_prisma_migrations` de prod pode estar **vazia ou incompleta**.

A migration catch-up `20260704000000_catalog_items_and_business_template` já foi
criada e fecha o gap (#2): agora a pasta `prisma/migrations` descreve o schema por
inteiro. Falta reconciliar o `_prisma_migrations` de PROD (#3).

## Pré-requisito: `DIRECT_URL` na Vercel

`migrate deploy` usa a conexão **direta** (`directUrl` no `schema.prisma`), não o
pooler pgbouncer. Confirme que **`DIRECT_URL`** (porta 5432) existe nos env vars de
**Production** na Vercel, além de `DATABASE_URL`. Sem isso, o migrate deploy do build
falha ou usa o pooler (que não suporta migration).

---

## Passo 0 — Destravar prod AGORA (não pode esperar o cutover)

No Supabase → SQL Editor, garanta que o schema de prod bate com o código já
deployado. Todos idempotentes; rode os que ainda faltam:

- [ ] `prisma/manual/2026-07-04-user-business-template.sql`  ✅ (já aplicado)
- [ ] `prisma/manual/2026-07-03-account-branding.sql`
- [ ] `prisma/manual/2026-07-03-vendas.sql`

**Validação** (deve retornar os nomes das tabelas, não `NULL`):

```sql
select
  to_regclass('public."AccountBranding"') as branding,
  to_regclass('public."CatalogItem"')     as catalog,
  to_regclass('public."Order"')           as orders,
  to_regclass('public."OrderItem"')       as order_items;
select column_name from information_schema.columns
  where table_name = 'User' and column_name = 'businessTemplateId';
```

Depois deste passo, **prod == schema.prisma**. Os erros do dia param aqui. Os passos
seguintes são o cutover propriamente dito (podem ser feitos com calma depois).

---

## Passo 1 — Confirmar que a pasta de migrations == schema (local)

Não deve haver drift entre o histórico e o schema. Rode local (dev):

```bash
# Requer um shadow DB (usa DIRECT_URL de dev). Deve dizer "No difference".
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$DIRECT_URL_DEV"
```

Se acusar diferença, gere uma migration com `prisma migrate dev --create-only` e
revise antes de prosseguir. (Com a catch-up já criada, deve estar limpo.)

## Passo 2 — Inspecionar o estado do `_prisma_migrations` de PROD

No Supabase → SQL Editor (banco de PROD):

```sql
-- Existe a tabela de controle do Prisma?
select to_regclass('public."_prisma_migrations"') as has_table;
-- O que já está registrado como aplicado?
select migration_name, finished_at, rolled_back_at
  from "_prisma_migrations" order by started_at;
```

Guarde o resultado — ele decide o Passo 3.

## Passo 3 — Baselinar PROD (marcar migrations como aplicadas SEM rodar o SQL)

Como prod **já** tem todas as tabelas (via manual/db push), marcamos cada migration
como aplicada com `migrate resolve --applied`. Isso só insere a linha em
`_prisma_migrations`; **não executa** o DDL (não recria nada).

Rode local apontando para PROD (as duas vars com valores de prod):

```bash
export DATABASE_URL="<pooler de PROD>"
export DIRECT_URL="<conexão direta 5432 de PROD>"

# Marque como aplicada CADA migration que ainda NÃO aparece no resultado do Passo 2.
# Se o Passo 2 mostrou a tabela vazia/inexistente, marque TODAS, nesta ordem:
npx prisma migrate resolve --applied 00000000000000_baseline
npx prisma migrate resolve --applied 20260629000000_message_reply_quote
npx prisma migrate resolve --applied 20260629010000_message_source
npx prisma migrate resolve --applied 20260630000000_message_media_fields
npx prisma migrate resolve --applied 20260701000000_outboundjob_media_fields
npx prisma migrate resolve --applied 20260701010000_funil_vendas_pagamento
npx prisma migrate resolve --applied 20260703000000_cancelamento_assinatura
npx prisma migrate resolve --applied 20260703010000_avisos_conta
npx prisma migrate resolve --applied 20260703020000_account_branding
npx prisma migrate resolve --applied 20260704000000_catalog_items_and_business_template
```

> Se o Passo 2 mostrou algumas já aplicadas, pule essas e resolva só as que faltam
> (quase sempre: as duas últimas, `account_branding` e a catch-up).

## Passo 4 — Verificar

```bash
# Ainda com DATABASE_URL/DIRECT_URL de PROD:
npx prisma migrate status
```

Esperado: **"Database schema is up to date!"** e nenhuma migration pendente.

Faça um deploy de teste (ou rode `npx prisma migrate deploy` contra prod): deve ser
**no-op** ("No pending migrations to apply."). A partir daí, todo deploy futuro que
inclua uma nova migration a aplica sozinho.

---

## Daqui pra frente (o fluxo correto)

1. Mudou o `schema.prisma`? Gere a migration: `npx prisma migrate dev --name <nome>`.
2. Commit da migration junto com o código.
3. Deploy → o build roda `migrate deploy` → aplica em prod automaticamente.
4. **Nunca mais** SQL manual no Supabase nem `db push` em prod. A pasta
   `prisma/manual/` fica só como registro histórico.

## Rollback / segurança

- `migrate resolve --applied` é reversível: se errar, `migrate resolve --rolled-back
  <nome>` remove a marca. Como nenhum DDL roda, não há risco de perda de dados nesses
  passos.
- Tenha um snapshot do Postgres de prod antes de começar (Supabase → Database →
  Backups) por precaução geral.

## Alternativa: rebaseline (squash)

Se preferir um histórico limpo em vez de 10 migrations, é possível apagar as
migrations e gerar um único baseline de `--from-empty` → `--to-schema-datamodel`, e
resolver só esse baseline em prod. Mais limpo, porém reescreve o histórico e obriga
todos os bancos de dev a rebaselinar também. Para este projeto, o caminho acima
(baseline incremental) é menos disruptivo e recomendado.
