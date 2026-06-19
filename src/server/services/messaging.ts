import { prisma } from "@/server/db/client";
import { getWhatsApp } from "@/server/whatsapp";
import { env } from "@/lib/env";
import { typingDelayMs, sleep } from "@/lib/humanize";

/**
 * O pool Baileys é importado de forma PREGUIÇOSA (só quando WHATSAPP_MODE=baileys).
 * Assim os modos mock/cloud-api — e o bundle do Next que importa este módulo —
 * nunca carregam a lib não-oficial (pesada, só-Node).
 */
const loadPool = () => import("@/server/whatsapp/baileys/pool");

/**
 * Envia uma mensagem via WhatsApp (mock, cloud-api ou baileys) e persiste como
 * OUTBOUND. Fonte única de verdade para envio reativo — usada pela conversa e
 * pelo agendamento, evitando duplicar a lógica de persistência em cada lugar.
 */
export async function sendWhatsAppMessage(
  lead: { id: string; phone: string; userId: string; whatsAppNumberId?: string | null },
  text: string,
): Promise<void> {
  if (env.WHATSAPP_MODE === "baileys") {
    // responde pelo chip que iniciou a conversa; senão, qualquer um conectado DA CONTA
    let numberId = lead.whatsAppNumberId ?? null;
    if (!numberId) {
      const healthy = await prisma.whatsAppNumber.findFirst({
        where: { userId: lead.userId, status: { in: ["CONNECTED", "WARMING"] } },
        select: { id: true },
      });
      numberId = healthy?.id ?? null;
    }
    if (!numberId) throw new Error("sem número Baileys disponível p/ responder");
    const { send: poolSend } = await loadPool();
    const out = await poolSend(numberId, lead.phone, text);
    if (!out.ok) throw new Error(`baileys reply falhou: ${out.reason}`);
    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        content: text,
        providerMessageId: out.providerMessageId,
        status: "SENT",
        whatsAppNumberId: numberId,
      },
    });
    await prisma.lead.update({ where: { id: lead.id }, data: { updatedAt: new Date() } });
    return;
  }

  // caminho original (mock/cloud-api):
  const wa = getWhatsApp();
  const { providerMessageId } = await wa.sendMessage(lead.phone, text);
  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "OUTBOUND",
      content: text,
      providerMessageId,
      status: "SENT",
    },
  });
  // Toca updatedAt do lead para o dashboard refletir atividade recente.
  await prisma.lead.update({
    where: { id: lead.id },
    data: { updatedAt: new Date() },
  });
}

/**
 * Executa um OutboundJob: respeita opt-out, escolhe template (cold) vs texto
 * (freeform/janela 24h), envia, persiste OUTBOUND e move o lead p/ CONTATADO.
 * Lança em falha (o worker trata retry/erro).
 *
 * No modo `baileys` o envio é roteado pelo chip escolhido na rotação (numberId
 * vindo do worker): verifica `onWhatsApp`, aplica o delay humano e grava o
 * `whatsAppNumberId` em job/message/lead (auditoria + cap por chip).
 */
export async function dispatchOutboundJob(
  jobId: string,
  opts: { numberId?: string } = {},
): Promise<void> {
  const job = await prisma.outboundJob.findUnique({
    where: { id: jobId },
    include: { lead: { select: { id: true, name: true, phone: true, optOut: true } } },
  });
  if (!job || !job.lead) return;
  const { lead } = job;
  if (lead.optOut) {
    await prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", lastError: "lead em opt-out" },
    });
    return;
  }

  // ── Baileys (multi-número) ──────────────────────────────────────────────
  if (env.WHATSAPP_MODE === "baileys") {
    const numberId = opts.numberId;
    if (!numberId) throw new Error("Baileys exige numberId (rotação no worker)");

    const { send: poolSend } = await loadPool();

    // simula digitação proporcional ANTES de enviar
    await sleep(
      typingDelayMs(job.content.length, {
        msPerChar: env.BAILEYS_TYPING_MS_PER_CHAR,
        maxMs: env.BAILEYS_TYPING_MAX_MS,
      }),
    );

    // O send() resolve o JID canônico (corrige o 9º dígito BR) e já aplica o
    // gate anti-spam (BAILEYS_ONWHATSAPP_CHECK). Número fora do WhatsApp → cancela.
    const out = await poolSend(numberId, lead.phone, job.content);
    if (!out.ok) {
      if (out.reason === "not_on_whatsapp") {
        await prisma.outboundJob.update({
          where: { id: jobId },
          data: { status: "CANCELLED", lastError: "número não está no WhatsApp" },
        });
        return;
      }
      throw new Error(`baileys send falhou: ${out.reason}`);
    }

    await prisma.$transaction([
      prisma.message.create({
        data: {
          leadId: lead.id,
          direction: "OUTBOUND",
          content: job.content,
          providerMessageId: out.providerMessageId,
          status: "SENT",
          whatsAppNumberId: numberId,
        },
      }),
      prisma.outboundJob.update({
        where: { id: jobId },
        data: { status: "SENT", sentAt: new Date(), whatsAppNumberId: numberId, deferCount: 0 },
      }),
      prisma.lead.update({
        where: { id: lead.id },
        data: { status: "CONTATADO", updatedAt: new Date(), whatsAppNumberId: numberId },
      }),
    ]);
    return;
  }

  // ── mock / cloud-api (caminho original, inalterado) ─────────────────────
  const wa = getWhatsApp();
  let providerMessageId: string;
  if (job.kind === "template" && env.WHATSAPP_TEMPLATE_NAME && wa.mode === "cloud-api") {
    const res = await wa.sendTemplate(
      lead.phone,
      job.templateName || env.WHATSAPP_TEMPLATE_NAME,
      env.WHATSAPP_TEMPLATE_LANG,
      [lead.name],
    );
    providerMessageId = res.providerMessageId;
  } else {
    // mock OU freeform: usa o conteúdo já renderizado
    const res = await wa.sendMessage(lead.phone, job.content);
    providerMessageId = res.providerMessageId;
  }

  await prisma.$transaction([
    prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        content: job.content,
        providerMessageId,
        status: "SENT",
      },
    }),
    prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: "SENT", sentAt: new Date(), deferCount: 0 },
    }),
    prisma.lead.update({
      where: { id: lead.id },
      data: { status: "CONTATADO", updatedAt: new Date() },
    }),
  ]);
}
