import { env } from "@/lib/env";
import { hourInTz, isWithinWindow, jitterMs } from "@/lib/sendWindow";
import { processNextJob, sentToday, sentTodayByNumber } from "./dispatcher";
import { selectNumber } from "@/server/whatsapp/baileys/selection";
import { sleep } from "@/lib/humanize";
import { prisma } from "@/server/db/client";

type Pool = typeof import("@/server/whatsapp/baileys/pool");
let pool: Pool | null = null;

/** Boot do modo Baileys: importa o pool, liga inbound/ack ao domínio e conecta. */
async function bootBaileys(): Promise<Pool> {
  const p = await import("@/server/whatsapp/baileys/pool");
  const { handleInbound } = await import("@/server/services/conversation.service");
  const { applyAck } = await import("@/server/services/webhook.service");
  p.registerHandlers({
    onInbound: (e) =>
      handleInbound({ phone: e.fromPhone, text: e.text, providerMessageId: e.providerMessageId }).then(() => {}),
    onAck: (id, status) => applyAck(id, status),
  });
  await p.ensureConnections();
  return p;
}

/** Escolhe o chip menos carregado e elegível para a próxima iteração. */
async function pickNumberId(now: Date): Promise<string | null> {
  const counts = await sentTodayByNumber(now);
  const nums = await prisma.whatsAppNumber.findMany({
    select: { id: true, status: true, dailyCap: true },
  });
  const chosen = selectNumber(
    nums.map((n) => ({ id: n.id, status: n.status, dailyCap: n.dailyCap, sentToday: counts[n.id] ?? 0 })),
  );
  return chosen?.id ?? null;
}

async function main() {
  console.log("[worker] iniciado. modo=%s cap/dia=%d", env.WHATSAPP_MODE, env.WHATSAPP_DAILY_CAP);
  if (env.WHATSAPP_MODE === "baileys") pool = await bootBaileys();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // mantém sockets vivos e conecta chips recém-pareados pela UI (gera o QR),
    // mesmo fora da janela comercial — pareamento não depende de horário.
    if (env.WHATSAPP_MODE === "baileys" && pool) await pool.ensureConnections();

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

    let numberId: string | undefined;
    if (env.WHATSAPP_MODE === "baileys") {
      const id = await pickNumberId(now);
      if (!id) {
        await sleep(30_000); // todos no cap / sem chip saudável
        continue;
      }
      numberId = id;
    }

    const sent = await processNextJob(now, numberId);
    await sleep(
      sent ? env.WHATSAPP_MIN_INTERVAL_MS + jitterMs(env.WHATSAPP_JITTER_MS) : env.WORKER_POLL_MS,
    );
  }
}

main().catch((e) => {
  console.error("[worker] erro fatal:", e);
  process.exit(1);
});
