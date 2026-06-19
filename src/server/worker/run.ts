import { env } from "@/lib/env";
import { hourInTz, isWithinWindow, jitterMs } from "@/lib/sendWindow";
import { processNextJob, sentToday } from "./dispatcher";
import { reclaimStuckJobs } from "./reaper";
import { sleep } from "@/lib/humanize";

type Pool = typeof import("@/server/whatsapp/baileys/pool");
let pool: Pool | null = null;

/** Boot do modo Baileys: importa o pool, liga inbound/ack ao domínio e conecta. */
async function bootBaileys(): Promise<Pool> {
  const p = await import("@/server/whatsapp/baileys/pool");
  const { handleInbound } = await import("@/server/services/conversation.service");
  const { applyAck } = await import("@/server/services/webhook.service");
  p.registerHandlers({
    onInbound: (e) =>
      handleInbound({
        phone: e.fromPhone,
        whatsAppNumberId: e.whatsAppNumberId,
        text: e.text,
        providerMessageId: e.providerMessageId,
      }).then(() => {}),
    onAck: (id, status) => applyAck(id, status),
  });
  await p.ensureConnections();
  return p;
}

async function main() {
  console.log("[worker] iniciado. modo=%s cap/dia=%d", env.WHATSAPP_MODE, env.WHATSAPP_DAILY_CAP);
  if (env.WHATSAPP_MODE === "baileys") pool = await bootBaileys();

  // Recupera jobs órfãos de execuções anteriores (deploy/crash deixou SENDING preso).
  const reclaimedOnBoot = await reclaimStuckJobs(new Date(), env.WORKER_LEASE_MS);
  if (reclaimedOnBoot > 0) console.log("[worker] reaper boot: %d jobs recuperados", reclaimedOnBoot);

  let lastReap = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // mantém sockets vivos e conecta chips recém-pareados pela UI (gera o QR),
    // mesmo fora da janela comercial — pareamento não depende de horário.
    if (env.WHATSAPP_MODE === "baileys" && pool) await pool.ensureConnections();

    if (Date.now() - lastReap >= env.WORKER_REAP_EVERY_MS) {
      const n = await reclaimStuckJobs(new Date(), env.WORKER_LEASE_MS);
      if (n > 0) console.log("[worker] reaper: %d jobs recuperados", n);
      lastReap = Date.now();
    }

    const now = new Date();
    const hour = hourInTz(now, env.SCHEDULING_TIMEZONE);
    if (
      !isWithinWindow(hour, {
        startHour: env.WHATSAPP_SEND_START_HOUR,
        endHour: env.WHATSAPP_SEND_END_HOUR,
      })
    ) {
      await sleep(60_000); // fora do horário comercial
      continue;
    }
    if ((await sentToday(now)) >= env.WHATSAPP_DAILY_CAP) {
      await sleep(60_000); // cap diário global atingido
      continue;
    }

    // O chip de envio (Baileys) é escolhido por conta dentro de processNextJob.
    const sent = await processNextJob(now);
    await sleep(
      sent ? env.WHATSAPP_MIN_INTERVAL_MS + jitterMs(env.WHATSAPP_JITTER_MS) : env.WORKER_POLL_MS,
    );
  }
}

main().catch((e) => {
  console.error("[worker] erro fatal:", e);
  process.exit(1);
});
