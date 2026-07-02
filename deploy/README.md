# deploy/ — worker na Oracle Cloud Free

Artefatos pra rodar o **worker** (Baileys / disparo / IA) numa VM da Oracle Cloud,
substituindo o serviço worker do Railway. O web continua na Vercel.

Runbook completo: [docs/plans/2026-07-01-migracao-worker-railway-para-oracle-cloud.md](../docs/plans/2026-07-01-migracao-worker-railway-para-oracle-cloud.md)

## Arquivos

| Arquivo | O quê |
|---|---|
| `oracle-setup.sh` | Bootstrap idempotente da VM: Node 22, clone, `npm install`, instala o serviço. **Não inicia.** |
| `crm-worker.service` | Unit `systemd` do worker (restart automático, log no journald). |
| `verify-worker.sh` | Checagem pós-cutover: serviço vivo + heartbeat fresco no Postgres. |

## Uso resumido

```bash
# na VM (Ubuntu 22.04), como usuário ubuntu:
export REPO_URL=https://github.com/mathmoraisdev/crm-teste.git
curl -fsSL "$REPO_URL/raw/master/deploy/oracle-setup.sh" | bash   # ou: git clone + bash deploy/oracle-setup.sh

nano /opt/crm/.env                    # colar as vars do worker (ver plano §3.2)
cd /opt/crm && npm run worker:prod    # gate: ver "[worker] iniciado" + chips CONNECTED, Ctrl+C

# CUTOVER (parar o worker no Railway ANTES):
sudo systemctl start crm-worker
bash /opt/crm/deploy/verify-worker.sh
```

## Regras críticas
- **Nunca dois workers vivos** (Railway + Oracle) — dupla conexão Baileys = envio duplicado + Bad MAC. Parar o Railway antes de dar `start`.
- **Mesmo `ENCRYPTION_KEY` da Vercel** no `.env` do worker (senão não decifra credenciais BYOK).
- **`REDIS_URL` externo** (Upstash) compartilhado entre Vercel e Oracle.
- **Só deletar o Railway** depois do worker estável na Oracle (rollback § do plano depende disso).
