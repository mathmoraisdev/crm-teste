import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { hourInTz, isWithinWindow, jitterMs } from "@/lib/sendWindow";
import { processNextJob } from "./dispatcher";
import { reclaimStuckJobs } from "./reaper";
import { runChip } from "./chipRunner";
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

  // Baileys: 1 runner (laço de envio) por chip enviável, supervisionado abaixo.
  const runners = new Map<string, { stopped: boolean }>();

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

    if (env.WHATSAPP_MODE === "baileys") {
      // Reconcilia: sobe um runner por chip vivo, derruba o de chip que saiu.
      const chips = await prisma.whatsAppNumber.findMany({
        where: { status: { in: ["CONNECTED", "WARMING"] } },
        select: { id: true, userId: true },
      });
      const live = new Set(chips.map((c) => c.id));
      for (const c of chips) {
        if (!runners.has(c.id)) {
          const sig = { stopped: false };
          runners.set(c.id, sig);
          void runChip(c, sig).finally(() => runners.delete(c.id));
        }
      }
      // sinaliza parada p/ chips que saíram (banido/pausado/desconectado)
      for (const [id, sig] of runners) if (!live.has(id)) sig.stopped = true;

      await sleep(env.WORKER_POLL_MS);
      continue;
    }

    // mock / cloud-api: sem chips por número — mantém o loop serial original.
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
