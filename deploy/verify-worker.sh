#!/usr/bin/env bash
#
# Verificação rápida do worker após o cutover (rodar na VM da Oracle).
# Checa: serviço systemd vivo, últimas linhas do log e o heartbeat no Postgres.
# Ver docs/plans/2026-07-01-migracao-worker-railway-para-oracle-cloud.md §7
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/crm}"

echo "==> systemd"
systemctl is-active crm-worker && systemctl status crm-worker --no-pager -n 3 || true

echo ""
echo "==> últimas 20 linhas do log"
journalctl -u crm-worker -n 20 --no-pager || true

echo ""
echo "==> heartbeat (WorkerHeartbeat.beatAt deve ser de segundos atrás)"
cd "$APP_DIR"
# Usa o Prisma já instalado; lê DATABASE_URL do .env via tsx.
# NB: envolto num async IIFE — o `tsx -e` compila como CJS e recusa top-level await
# ("Top-level await is currently not supported with the cjs output format").
npx tsx --env-file-if-exists=.env -e '
  import { PrismaClient } from "@prisma/client";
  (async () => {
    const p = new PrismaClient();
    const hb = await p.workerHeartbeat.findUnique({ where: { id: "singleton" } });
    if (!hb) { console.log("SEM heartbeat — worker nunca bateu?"); process.exit(1); }
    const ageS = Math.round((Date.now() - hb.beatAt.getTime()) / 1000);
    console.log(`beatAt=${hb.beatAt.toISOString()} (há ${ageS}s)`);
    console.log(ageS < 30 ? "OK: worker vivo" : "ALERTA: heartbeat velho — worker parado?");
    await p.$disconnect();
  })();
' || echo "(falha ao consultar heartbeat — confira DATABASE_URL no .env)"
