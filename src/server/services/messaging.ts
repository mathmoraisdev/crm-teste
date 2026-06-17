import { prisma } from "@/server/db/client";
import { getWhatsApp } from "@/server/whatsapp";
import { env } from "@/lib/env";

/**
 * Envia uma mensagem via WhatsApp (mock ou real) e persiste como OUTBOUND.
 * Fonte única de verdade para envio — usada pela conversa e pelo agendamento,
 * evitando duplicar a lógica de persistência em cada lugar.
 */
export async function sendWhatsAppMessage(
  lead: { id: string; phone: string },
  text: string,
): Promise<void> {
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
 */
export async function dispatchOutboundJob(jobId: string): Promise<void> {
  const job = await prisma.outboundJob.findUnique({
    where: { id: jobId },
    include: { lead: { select: { id: true, name: true, phone: true, optOut: true } } },
  });
  if (!job || !job.lead) return;
  if (job.lead.optOut) {
    await prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", lastError: "lead em opt-out" },
    });
    return;
  }

  const wa = getWhatsApp();
  const { lead } = job;
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
      data: { status: "SENT", sentAt: new Date() },
    }),
    prisma.lead.update({
      where: { id: lead.id },
      data: { status: "CONTATADO", updatedAt: new Date() },
    }),
  ]);
}
