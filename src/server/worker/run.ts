import { env } from "@/lib/env";
import { hourInTz, isWithinWindow, jitterMs } from "@/lib/sendWindow";
import { processNextJob, sentToday } from "./dispatcher";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(
    "[worker] iniciado. cap/dia=%d intervalo=%dms",
    env.WHATSAPP_DAILY_CAP,
    env.WHATSAPP_MIN_INTERVAL_MS,
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
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
      await sleep(60_000); // cap diário atingido
      continue;
    }

    const sent = await processNextJob(now);
    if (sent) {
      await sleep(env.WHATSAPP_MIN_INTERVAL_MS + jitterMs(env.WHATSAPP_JITTER_MS));
    } else {
      await sleep(env.WORKER_POLL_MS); // fila vazia / nada elegível
    }
  }
}

main().catch((e) => {
  console.error("[worker] erro fatal:", e);
  process.exit(1);
});
