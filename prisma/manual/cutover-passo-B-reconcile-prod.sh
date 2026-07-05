#!/usr/bin/env bash
# Cutover — Parte B: reconciliar o _prisma_migrations de PROD.
# Rode LOCAL apontando para PROD. NÃO toca no seu banco de dev.
# Pré: snapshot do Postgres de PROD (Supabase → Database → Backups).
#
# Uso:
#   export DATABASE_URL="<pooler de PROD, 6543>"
#   export DIRECT_URL="<conexão direta de PROD, 5432>"
#   bash prisma/manual/cutover-passo-B-reconcile-prod.sh
#
# O que faz: mostra o estado atual, marca como aplicada (SEM rodar DDL) cada
# migration que o Prisma considera pendente em PROD, e confirma. `migrate resolve
# --applied` só insere a linha em _prisma_migrations; não executa SQL → não recria
# nada. É reversível: `prisma migrate resolve --rolled-back <nome>`.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" || -z "${DIRECT_URL:-}" ]]; then
  echo "ERRO: exporte DATABASE_URL e DIRECT_URL de PROD antes de rodar." >&2
  exit 1
fi

echo "=== [1] Estado atual em PROD (o que o Prisma acha que falta aplicar) ==="
# migrate status lista as migrations "not yet applied". Se disser "up to date",
# não há nada a fazer (pode sair).
npx prisma migrate status || true

echo ""
echo "=== [2] Resolvendo as pendentes como --applied (sem rodar DDL) ==="
# Extrai da saída do status os nomes das migrations não aplicadas e resolve cada
# uma. Se o status já disser "up to date", o loop não roda nada.
PENDING=$(npx prisma migrate status 2>/dev/null \
  | grep -oE '[0-9]{14}_[a-z0-9_]+' | sort -u || true)

if [[ -z "$PENDING" ]]; then
  echo "Nenhuma pendente — PROD já está reconciliado."
else
  for m in $PENDING; do
    echo "-> migrate resolve --applied $m"
    npx prisma migrate resolve --applied "$m" || echo "   (já registrada / ok, seguindo)"
  done
fi

echo ""
echo "=== [3] Confirmação (esperado: 'Database schema is up to date!') ==="
npx prisma migrate status

echo ""
echo "=== [4] Prova final: migrate deploy deve ser NO-OP ==="
npx prisma migrate deploy
echo "OK — daqui pra frente todo deploy aplica migrations novas sozinho."
