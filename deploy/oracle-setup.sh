#!/usr/bin/env bash
#
# Setup do worker do CRM numa VM Oracle Cloud (Ubuntu 22.04, ARM64 ou x86_64).
# Idempotente: pode rodar de novo pra atualizar o código/dependências.
#
# Uso:
#   curl -fsSL <raw-url>/deploy/oracle-setup.sh | bash        # 1ª vez
#   sudo bash /opt/crm/deploy/oracle-setup.sh                  # atualizar depois
#
# NÃO inicia o serviço no fim — o start é manual, no cutover (ver o plano).
# Ver docs/plans/2026-07-01-migracao-worker-railway-para-oracle-cloud.md
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mathmoraisdev/crm-teste.git}"
APP_DIR="${APP_DIR:-/opt/crm}"
APP_USER="${APP_USER:-ubuntu}"
NODE_MAJOR="${NODE_MAJOR:-22}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ── 1. Dependências de sistema ──────────────────────────────────────────────
log "Instalando dependências de sistema (git, build-essential, curl)"
sudo apt-get update -y
sudo apt-get install -y git build-essential ca-certificates curl

# ── 2. Node 22 (engines: "node": "22.x") ────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" != "$NODE_MAJOR" ]; then
  log "Instalando Node ${NODE_MAJOR}.x via NodeSource"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
log "Node: $(node -v) / npm: $(npm -v)"

# ── 3. Código ───────────────────────────────────────────────────────────────
if [ ! -d "$APP_DIR/.git" ]; then
  log "Clonando repo em ${APP_DIR}"
  sudo mkdir -p "$APP_DIR"
  sudo chown "$APP_USER":"$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
else
  log "Atualizando repo em ${APP_DIR}"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
fi

# ── 4. Dependências do app (roda o postinstall: patch-wa-bridge) ────────────
log "npm install (+ postinstall: patch do whatsapp-rust-bridge)"
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --no-audit --no-fund
log "prisma generate"
sudo -u "$APP_USER" npx prisma generate

# ── 5. Aviso sobre o .env ───────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  log "ATENÇÃO: crie ${APP_DIR}/.env com as variáveis do worker (ver .env.example e o plano §3.2)"
  echo "    Sem o .env o worker NÃO sobe. Depois: sudo systemctl start crm-worker"
fi

# ── 6. Instala/atualiza o serviço systemd (mas NÃO inicia) ──────────────────
log "Instalando unit crm-worker.service"
sudo cp "$APP_DIR/deploy/crm-worker.service" /etc/systemd/system/crm-worker.service
sudo systemctl daemon-reload
sudo systemctl enable crm-worker

cat <<'EOF'

============================================================
 Setup concluído.

 Próximos passos (NÃO iniciados por este script):
   1. Editar o .env:            nano /opt/crm/.env
   2. Teste manual (gate):      cd /opt/crm && npm run worker:prod
      -> esperar "[worker] iniciado" e chips CONNECTED, depois Ctrl+C
   3. CUTOVER: parar o worker no Railway, então:
        sudo systemctl start crm-worker
        sudo journalctl -u crm-worker -f
============================================================
EOF
