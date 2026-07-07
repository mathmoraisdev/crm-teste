import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { hourInTz, isWithinWindow, jitterMs } from "@/lib/sendWindow";
import { processNextJob, processManualReplies } from "./dispatcher";
import { reclaimStuckJobs } from "./reaper";
import { runChip } from "./chipRunner";
import { dispatchDueReminders } from "@/server/services/meeting-reminders";
import { dispatchDueAppointmentReminders } from "@/server/services/appointment-reminders";
import { purgeExpiredMedia } from "@/server/services/media-retention";
import { dispatchLifecycleAutomations } from "@/server/services/lifecycle-automation";
import { dispatchPendingFiscalEmissions } from "@/server/services/fiscal-emission";
import { reconcileAiResume } from "@/server/services/conversation.service";
import { scheduleResponse } from "./respond-queue";
import { sleep } from "@/lib/humanize";
import { logger } from "@/lib/logger";

type Pool = typeof import("@/server/whatsapp/baileys/pool");
let pool: Pool | null = null;

/** Boot do modo Baileys: importa o pool, liga inbound/ack ao domínio e conecta. */
async function bootBaileys(): Promise<Pool> {
  const p = await import("@/server/whatsapp/baileys/pool");
  const { ingestInbound, ingestInboundMedia, handleOperatorMessage, handleOperatorMedia } =
    await import("@/server/services/conversation.service");
  const { scheduleResponse, cancelResponse } = await import("./respond-queue");
  const { applyAck } = await import("@/server/services/webhook.service");
  p.registerHandlers({
    // Inbound: persiste na hora (ingest) e AGENDA a resposta com debounce — junta
    // mensagens picadas e dá o tempo de espera configurado por número.
    onInbound: (e) =>
      ingestInbound({
        phone: e.fromPhone,
        whatsAppNumberId: e.whatsAppNumberId,
        text: e.text,
        providerMessageId: e.providerMessageId,
        quotedProviderMessageId: e.quotedProviderMessageId,
      })
        .then((r) => {
          if (r.respond && r.leadId) scheduleResponse(r.leadId, r.delayMs);
        })
        .catch((err) => {
          // Nunca deixar a falha virar unhandled rejection: o lead fica sem
          // resposta, mas pelo menos fica rastreável (chip + telefone + erro).
          logger.error(
            { whatsAppNumberId: e.whatsAppNumberId, fromPhone: e.fromPhone, err },
            "[worker] ingestInbound falhou",
          );
        }),
    // Operador respondeu manual pelo zap (fromMe não-bot): registra, pausa a IA
    // (se configurado) e cancela qualquer resposta em debounce pendente.
    onOperatorMessage: (e) =>
      handleOperatorMessage({
        toPhone: e.toPhone,
        text: e.text,
        providerMessageId: e.providerMessageId,
        whatsAppNumberId: e.whatsAppNumberId,
      })
        .then((r) => {
          if (r.leadId) cancelResponse(r.leadId);
        })
        .catch((err) => {
          logger.error(
            { whatsAppNumberId: e.whatsAppNumberId, toPhone: e.toPhone, err },
            "[worker] handleOperatorMessage falhou",
          );
        }),
    // Operador respondeu com ARQUIVO pelo próprio zap (fromMe mídia): registra
    // como OUTBOUND (com o anexo) e cancela qualquer resposta em debounce.
    onOperatorMedia: (e) =>
      handleOperatorMedia({
        toPhone: e.toPhone,
        placeholder: e.placeholder,
        providerMessageId: e.providerMessageId,
        whatsAppNumberId: e.whatsAppNumberId,
        caption: e.caption,
        buffer: e.buffer,
        mediaType: e.mediaType,
        mime: e.mime,
        fileName: e.fileName,
      })
        .then((r) => {
          if (r.leadId) cancelResponse(r.leadId);
        })
        .catch((err) => {
          logger.error(
            { whatsAppNumberId: e.whatsAppNumberId, toPhone: e.toPhone, err },
            "[worker] handleOperatorMedia falhou",
          );
        }),
    // Mídia do lead sem legenda: persiste o placeholder no inbox (sem IA) e, p/
    // imagem/PDF, sobe o arquivo baixado ao storage privado p/ download.
    onInboundMedia: (e) =>
      ingestInboundMedia({
        phone: e.fromPhone,
        whatsAppNumberId: e.whatsAppNumberId,
        placeholder: e.placeholder,
        providerMessageId: e.providerMessageId,
        buffer: e.buffer,
        mediaType: e.mediaType,
        mime: e.mime,
        fileName: e.fileName,
        audioSeconds: e.audioSeconds,
      })
        .then((r) => {
          // Áudio transcrito → agenda a resposta da IA como se fosse texto.
          if (r.respond && r.leadId) scheduleResponse(r.leadId, r.delayMs);
        })
        .catch((err) => {
          logger.error(
            { whatsAppNumberId: e.whatsAppNumberId, fromPhone: e.fromPhone, err },
            "[worker] ingestInboundMedia falhou",
          );
        }),
    onAck: (id, status) => applyAck(id, status),
  });
  await p.ensureConnections();
  return p;
}

async function main() {
  logger.info(
    { mode: env.WHATSAPP_MODE, dailyCap: env.WHATSAPP_DAILY_CAP },
    "[worker] iniciado",
  );
  // Diagnóstico: o agendamento roda AQUI (worker). Se calendar=google-calendar
  // mas as credenciais estão AUSENTES, proposeSlots quebra e o lead fica sem
  // resposta. Imprime no boot p/ flagrar variável faltando no serviço do worker.
  logger.info(
    {
      calendar: env.CALENDAR_MODE,
      googleCreds: env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY ? "presentes" : "AUSENTES",
    },
    "[worker] calendar",
  );
  if (env.WHATSAPP_MODE === "baileys") pool = await bootBaileys();

  // Recupera jobs órfãos de execuções anteriores (deploy/crash deixou SENDING preso).
  const reclaimedOnBoot = await reclaimStuckJobs(new Date(), env.WORKER_LEASE_MS);
  if (reclaimedOnBoot > 0)
    logger.info({ reclaimed: reclaimedOnBoot }, "[worker] reaper boot: jobs recuperados");

  // Baileys: 1 runner (laço de envio) por chip enviável, supervisionado abaixo.
  const runners = new Map<string, { stopped: boolean }>();

  let lastReap = Date.now();
  let lastChipAlert = 0;
  let lastReminder = 0;
  let lastAiResume = 0;
  let lastRetention = 0;
  let lastLifecycle = 0;
  let lastFiscal = 0;
  while (true) {
    // Heartbeat: prova de vida do worker p/ a rota de health (deploy travado/crash).
    const beat = new Date();
    await prisma.workerHeartbeat.upsert({
      where: { id: "singleton" },
      update: { beatAt: beat },
      create: { id: "singleton", beatAt: beat },
    });

    // mantém sockets vivos e conecta chips recém-pareados pela UI (gera o QR),
    // mesmo fora da janela comercial — pareamento não depende de horário.
    if (env.WHATSAPP_MODE === "baileys" && pool) await pool.ensureConnections();

    // Drena as respostas manuais do operador enfileiradas pelo web (que não tem
    // socket). Roda SEMPRE (independe de janela/cap): é resposta reativa de
    // conversa, não disparo. Latência ≈ WORKER_POLL_MS.
    if (env.WHATSAPP_MODE === "baileys" && pool) {
      try {
        const n = await processManualReplies(new Date());
        if (n > 0) logger.info({ sent: n }, "[worker] respostas manuais enviadas");
      } catch (err) {
        logger.error({ err }, "[worker] processManualReplies falhou");
      }
    }

    if (Date.now() - lastReap >= env.WORKER_REAP_EVERY_MS) {
      const n = await reclaimStuckJobs(new Date(), env.WORKER_LEASE_MS);
      if (n > 0) logger.info({ reclaimed: n }, "[worker] reaper: jobs recuperados");
      lastReap = Date.now();
    }

    // Lembretes de reunião ao lead (véspera / 1h antes). Throttle de 60s: a
    // granularidade do lembrete é minuto, não precisa rodar a cada poll.
    if (Date.now() - lastReminder >= 60_000) {
      try {
        const r = await dispatchDueReminders(new Date());
        if (r > 0) logger.info({ sent: r }, "[worker] lembretes de reunião enviados");
      } catch (err) {
        logger.error({ err }, "[worker] dispatchDueReminders falhou");
      }
      // Lembretes de AGENDAMENTO de serviço (Appointment). Try/catch próprio:
      // falha aqui não derruba o lembrete de reunião (e vice-versa).
      try {
        const r = await dispatchDueAppointmentReminders(new Date());
        if (r > 0) logger.info({ sent: r }, "[worker] lembretes de agendamento enviados");
      } catch (err) {
        logger.error({ err }, "[worker] dispatchDueAppointmentReminders falhou");
      }
      lastReminder = Date.now();
    }

    // Retenção de mídia: apaga binários antigos do Storage (Message e transcrição
    // de áudio permanecem; o inbox cai no placeholder). Desligado por padrão
    // (MEDIA_RETENTION_DAYS=0) → o bloco nem roda. Throttle próprio (default 6h):
    // a granularidade da retenção é dia, não precisa rodar a cada poll.
    if (
      env.MEDIA_RETENTION_DAYS > 0 &&
      Date.now() - lastRetention >= env.MEDIA_RETENTION_EVERY_MS
    ) {
      try {
        const n = await purgeExpiredMedia(new Date());
        if (n > 0) logger.info({ purged: n }, "[worker] mídia antiga apagada");
      } catch (err) {
        logger.error({ err }, "[worker] purgeExpiredMedia falhou");
      }
      lastRetention = Date.now();
    }

    // Automação de ciclo de vida (pós-venda / NPS / reengajamento de frio). O
    // serviço é no-op se LIFECYCLE_AUTOMATION=false (kill-switch) ou fora da janela
    // comercial. Throttle próprio (default 15 min): a granularidade é hora/dia, não
    // precisa rodar a cada poll. Roda nos dois modos (envio por chip no baileys,
    // Graph no cloud).
    if (Date.now() - lastLifecycle >= env.LIFECYCLE_EVERY_MS) {
      try {
        const n = await dispatchLifecycleAutomations(new Date());
        if (n > 0) logger.info({ sent: n }, "[worker] automações de ciclo de vida enviadas");
      } catch (err) {
        logger.error({ err }, "[worker] dispatchLifecycleAutomations falhou");
      }
      lastLifecycle = Date.now();
    }

    // Emissão fiscal (NFC-e). No-op se FISCAL_EMISSION=false (kill-switch) — sobe
    // inerte. Throttle próprio (default 1 min): SEFAZ é lento, não precisa a cada
    // poll. Try/catch próprio: falha aqui não derruba os outros ticks. Roda nos dois
    // modos (baileys/cloud).
    if (Date.now() - lastFiscal >= env.FISCAL_EVERY_MS) {
      try {
        const n = await dispatchPendingFiscalEmissions(new Date());
        if (n > 0) logger.info({ resolved: n }, "[worker] emissões fiscais resolvidas");
      } catch (err) {
        logger.error({ err }, "[worker] dispatchPendingFiscalEmissions falhou");
      }
      lastFiscal = Date.now();
    }

    // Devolve a IA à conversa quando o operador retoma (handback/resolve) ou o
    // handoff esfria por inatividade — respondendo a backlog SEM esperar inbound
    // novo. Roda nos dois modos (o envio é por chip no baileys, Graph no cloud).
    // Throttle de 30s: a granularidade da inatividade é minuto.
    if (Date.now() - lastAiResume >= 30_000) {
      try {
        for (const leadId of await reconcileAiResume(new Date())) scheduleResponse(leadId, 0);
      } catch (err) {
        logger.error({ err }, "[worker] reconcileAiResume falhou");
      }
      lastAiResume = Date.now();
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

      // Alerta: 0 chips vivos mas há fila pendente → operador precisa repor números.
      // Throttle de 1 min p/ não floodar o log a cada poll.
      if (chips.length === 0 && Date.now() - lastChipAlert >= 60_000) {
        const pendingJobs = await prisma.outboundJob.count({ where: { status: "PENDING" } });
        if (pendingJobs > 0) {
          logger.error(
            { pendingJobs },
            "[worker] ALERTA: 0 chips vivos com jobs PENDING — repor números p/ retomar o disparo",
          );
          lastChipAlert = Date.now();
        }
      }

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
  logger.error({ err: e }, "[worker] erro fatal");
  process.exit(1);
});
