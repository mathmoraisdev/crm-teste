import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { hourInTz, isWithinWindow } from "@/lib/sendWindow";
import { sleep } from "@/lib/humanize";
import { dispatchOutboundJob } from "@/server/services/messaging";
import { claimNextJobForAccount, sentTodayByUser, underAccountCap } from "./dispatcher";
import { perChipDelayMs } from "./pacing";

/**
 * Laço de envio de UM chip. Roda até `signal.stopped` virar true (chip banido/
 * removido). Cada iteração: respeita janela + cap por conta, trava 1 job da conta
 * dona do chip, envia por este chip, e pausa o pacing agressivo.
 */
export async function runChip(
  chip: { id: string; userId: string },
  signal: { stopped: boolean },
): Promise<void> {
  while (!signal.stopped) {
    const now = new Date();
    const hour = hourInTz(now, env.SCHEDULING_TIMEZONE);
    if (!isWithinWindow(hour, { startHour: env.WHATSAPP_SEND_START_HOUR, endHour: env.WHATSAPP_SEND_END_HOUR })) {
      await sleep(60_000);
      continue;
    }
    if (!underAccountCap(await sentTodayByUser(chip.userId, now), env.WHATSAPP_DAILY_CAP)) {
      await sleep(60_000);
      continue;
    }
    // o chip ainda está saudável?
    const fresh = await prisma.whatsAppNumber.findUnique({ where: { id: chip.id }, select: { status: true } });
    if (!fresh || !["CONNECTED", "WARMING"].includes(fresh.status)) {
      signal.stopped = true;
      break;
    }

    const jobId = await claimNextJobForAccount(chip.userId, now);
    if (!jobId) {
      await sleep(env.WORKER_POLL_MS);
      continue;
    }

    try {
      await dispatchOutboundJob(jobId, { numberId: chip.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const job = await prisma.outboundJob.findUnique({ where: { id: jobId }, select: { attempts: true } });
      const failed = (job?.attempts ?? 99) >= 3;
      await prisma.outboundJob.update({
        where: { id: jobId },
        data: failed
          ? { status: "FAILED", lastError: msg, claimedAt: null }
          : {
              status: "PENDING",
              lastError: msg,
              claimedAt: null,
              whatsAppNumberId: null,
              scheduledFor: new Date(Date.now() + 60_000),
            },
      });
    }
    await sleep(perChipDelayMs(env.MASS_PER_CHIP_MIN_INTERVAL_MS, env.MASS_PER_CHIP_JITTER_MS));
  }
}
