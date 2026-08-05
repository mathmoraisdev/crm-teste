import { prisma } from "@/server/db/client";
import type { MessageSource } from "@prisma/client";
import { getWhatsApp } from "@/server/whatsapp";
import { env } from "@/lib/env";
import { typingDelayMs, sleep } from "@/lib/humanize";
import { invalidateConversation } from "@/server/cache/keys";
import { publishTenantEvent } from "@/server/events/bus";
import { downloadMediaBuffer } from "@/server/storage/media-storage";
import { MEDIA_TYPE_PLACEHOLDER } from "@/server/whatsapp/baileys/media";
import type { SendMedia } from "@/server/whatsapp/baileys/pool";

/** Metadados de um anexo de saída já no storage (o web sobe antes de enfileirar). */
export interface OutboundMedia {
  mediaPath: string;
  mediaType: "image" | "document" | "audio";
  mediaMime: string;
  fileName?: string | null;
}

/**
 * `kind` reservado para a resposta MANUAL do operador no modo Baileys. O socket
 * vive só no worker, mas o "Enviar" da inbox roda no web (no_socket). Então o web
 * grava um OutboundJob com este kind (intenção) e o worker o drena e envia pelo
 * chip do lead (ver processManualReplies / dispatchManualReplyJob). O dispatcher
 * de CAMPANHA ignora este kind (não aplica rodapé/cap/janela nem muda o status).
 */
export const MANUAL_REPLY_KIND = "manual_reply";

/**
 * `kind` das notificações transacionais do SISTEMA (ex.: confirmação de
 * agendamento) originadas no WEB. Mesma motivação do manual_reply — o web não tem
 * socket Baileys —, então o web enfileira e o worker drena pelo MESMO dreno reativo
 * (envio imediato, SEM rodapé de opt-out, sem janela/cap). A única diferença é o
 * `source` gravado na Message (SYSTEM, não OPERATOR). O dispatcher de CAMPANHA
 * também ignora este kind.
 */
export const SYSTEM_MESSAGE_KIND = "system_notify";

/**
 * O pool Baileys é importado de forma PREGUIÇOSA (só quando WHATSAPP_MODE=baileys).
 * Assim os modos mock/cloud-api — e o bundle do Next que importa este módulo —
 * nunca carregam a lib não-oficial (pesada, só-Node).
 */
const loadPool = () => import("@/server/whatsapp/baileys/pool");

/**
 * Pura: anexa o rodapé de descadastro (LGPD) ao conteúdo. No-op se o texto
 * estiver vazio ou se a mensagem já o contém (evita duplicar em re-toques).
 */
export function appendOptOutFooter(content: string, footer: string): string {
  const f = footer.trim();
  if (!f || content.includes(f)) return content;
  return `${content}\n\n${f}`;
}

/** Aplica o rodapé conforme a config de ambiente (efeito → lê env). */
function withOptOutFooter(content: string): string {
  if (!env.OUTBOUND_OPTOUT_FOOTER) return content;
  return appendOptOutFooter(content, env.OUTBOUND_OPTOUT_FOOTER_TEXT);
}

/**
 * Resolve a mensagem citada (reply) p/ um envio do operador. Valida que ela
 * pertence ao MESMO lead (anti-cross-thread) e devolve:
 *  - `messageId`: id interno p/ gravar Message.replyToId (vínculo na UI);
 *  - `quote`: ref WA (providerMessageId/fromMe/texto) p/ o `quoted` do Baileys,
 *    ou null se a citada não tem providerMessageId (não dá p/ citar no WhatsApp,
 *    mas o vínculo na UI permanece).
 * Retorna null quando não há citação ou a msg não é deste lead.
 */
async function resolveQuotedRef(
  leadId: string,
  replyToMessageId: string | null,
): Promise<{ messageId: string; quote: { id: string; text: string; fromMe: boolean } | null } | null> {
  if (!replyToMessageId) return null;
  const m = await prisma.message.findFirst({
    where: { id: replyToMessageId, leadId },
    select: { id: true, content: true, direction: true, providerMessageId: true },
  });
  if (!m) return null;
  return {
    messageId: m.id,
    quote: m.providerMessageId
      ? { id: m.providerMessageId, text: m.content, fromMe: m.direction === "OUTBOUND" }
      : null,
  };
}

/**
 * Envia uma mensagem via WhatsApp (mock, cloud-api ou baileys) e persiste como
 * OUTBOUND. Fonte única de verdade para envio reativo — usada pela conversa e
 * pelo agendamento, evitando duplicar a lógica de persistência em cada lugar.
 */
export async function sendWhatsAppMessage(
  lead: { id: string; phone: string; userId: string; whatsAppNumberId?: string | null },
  text: string,
  opts: { replyToMessageId?: string | null; source?: MessageSource } = {},
): Promise<void> {
  // Envio reativo é, por padrão, da IA (resposta conversacional). Lembretes e
  // outros automatismos passam source explícito (SYSTEM) p/ não inflar a métrica.
  const source: MessageSource = opts.source ?? "AI";
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
    const quoted = await resolveQuotedRef(lead.id, opts.replyToMessageId ?? null);
    const { send: poolSend } = await loadPool();
    const out = await poolSend(numberId, lead.phone, text, quoted?.quote);
    if (!out.ok) throw new Error(`baileys reply falhou: ${out.reason}`);
    await prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        content: text,
        providerMessageId: out.providerMessageId,
        status: "SENT",
        whatsAppNumberId: numberId,
        replyToId: quoted?.messageId ?? null,
        source,
      },
    });
    await prisma.lead.update({ where: { id: lead.id }, data: { updatedAt: new Date() } });
    await invalidateConversation(lead.id); // OUTBOUND novo → contexto da IA mudou
    // Avisa o front (SSE) — quem estiver com o detalhe/inbox deste lead revalida.
    await publishTenantEvent(lead.userId, { type: "conversation:changed", leadId: lead.id });
    return;
  }

  // caminho original (mock/cloud-api): não há quote nativo, mas guardamos o
  // vínculo (replyToId) p/ a UI renderizar a citação de forma consistente.
  const quoted = await resolveQuotedRef(lead.id, opts.replyToMessageId ?? null);
  const wa = getWhatsApp();
  const { providerMessageId } = await wa.sendMessage(lead.phone, text);
  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "OUTBOUND",
      content: text,
      providerMessageId,
      status: "SENT",
      replyToId: quoted?.messageId ?? null,
      source,
    },
  });
  // Toca updatedAt do lead para o dashboard refletir atividade recente.
  await prisma.lead.update({
    where: { id: lead.id },
    data: { updatedAt: new Date() },
  });
  await invalidateConversation(lead.id); // OUTBOUND novo → contexto da IA mudou
}

/**
 * Envio DIRETO de anexo (mock/cloud-api): sobe o media pelo provedor e persiste
 * como Message(OUTBOUND) com o ponteiro do storage (p/ o inbox renderizar). O
 * buffer já veio do web (upload da rota); `media.mediaPath` é só p/ a Message.
 * No Baileys este caminho NÃO roda — lá o web enfileira e o worker envia.
 */
export async function sendWhatsAppMedia(
  lead: { id: string; phone: string; userId: string; whatsAppNumberId?: string | null },
  media: OutboundMedia & { buffer: Buffer },
  opts: { caption?: string; replyToMessageId?: string | null; source?: MessageSource } = {},
): Promise<void> {
  const source: MessageSource = opts.source ?? "OPERATOR";
  const quoted = await resolveQuotedRef(lead.id, opts.replyToMessageId ?? null);
  const wa = getWhatsApp();
  const { providerMessageId } = await wa.sendMedia(lead.phone, {
    buffer: media.buffer,
    mediaType: media.mediaType,
    mime: media.mediaMime,
    fileName: media.fileName ?? undefined,
    caption: opts.caption,
  });
  await prisma.message.create({
    data: {
      leadId: lead.id,
      direction: "OUTBOUND",
      // legenda quando houver; senão o placeholder ("📷 Imagem") p/ a bolha.
      content: opts.caption?.trim() ? opts.caption : MEDIA_TYPE_PLACEHOLDER[media.mediaType],
      providerMessageId,
      status: "SENT",
      replyToId: quoted?.messageId ?? null,
      source,
      mediaPath: media.mediaPath,
      mediaType: media.mediaType,
      mediaMime: media.mediaMime,
      fileName: media.fileName,
    },
  });
  await prisma.lead.update({ where: { id: lead.id }, data: { updatedAt: new Date() } });
  await invalidateConversation(lead.id);
}

/**
 * Resolve o chip que envia uma resposta manual: o chip dono da conversa, senão
 * qualquer um conectado/aquecendo DA CONTA. Usado no enqueue (web).
 */
async function resolveReplyChip(
  userId: string,
  preferId: string | null,
): Promise<string | null> {
  if (preferId) return preferId;
  const healthy = await prisma.whatsAppNumber.findFirst({
    where: { userId, status: { in: ["CONNECTED", "WARMING"] } },
    select: { id: true },
  });
  return healthy?.id ?? null;
}

/**
 * Enfileira a resposta manual do operador (modo Baileys). Roda no WEB, onde NÃO
 * há socket Baileys — por isso só grava a intenção (OutboundJob) que o worker
 * drena e envia. Sem isto o envio direto pelo web falha com `no_socket`.
 */
export async function enqueueManualReply(
  lead: { id: string; phone: string; userId: string; whatsAppNumberId?: string | null },
  text: string,
  opts: { replyToMessageId?: string | null } = {},
): Promise<void> {
  const numberId = await resolveReplyChip(lead.userId, lead.whatsAppNumberId ?? null);
  if (!numberId) throw new Error("sem número Baileys disponível p/ responder");
  await prisma.outboundJob.create({
    data: {
      leadId: lead.id,
      kind: MANUAL_REPLY_KIND,
      content: text, // resposta humana: SEM rodapé de opt-out
      status: "PENDING",
      whatsAppNumberId: numberId,
      scheduledFor: new Date(),
      replyToMessageId: opts.replyToMessageId ?? null, // citação (reply) opcional
    },
  });
}

/**
 * Enfileira uma notificação transacional do SISTEMA (ex.: confirmação de
 * agendamento). Roda no WEB (sem socket Baileys): grava um OutboundJob que o worker
 * drena pelo mesmo `processManualReplies`/`dispatchManualReplyJob` (source SYSTEM).
 * Best-effort: se a conta não tem chip saudável, apenas NÃO enfileira (retorna
 * false) — a notificação é opcional e não deve derrubar o fluxo chamador.
 */
export async function enqueueSystemMessage(
  lead: { id: string; phone: string; userId: string; whatsAppNumberId?: string | null },
  text: string,
): Promise<boolean> {
  const numberId = await resolveReplyChip(lead.userId, lead.whatsAppNumberId ?? null);
  if (!numberId) return false; // sem chip → nada a enviar (silencioso, não lança)
  await prisma.outboundJob.create({
    data: {
      leadId: lead.id,
      kind: SYSTEM_MESSAGE_KIND,
      content: text, // transacional: SEM rodapé de opt-out
      status: "PENDING",
      whatsAppNumberId: numberId,
      scheduledFor: new Date(),
    },
  });
  return true;
}

/**
 * Enfileira o ENVIO de um anexo pelo operador (modo Baileys). O web já subiu o
 * arquivo ao storage (media.mediaPath); aqui só grava a intenção. O worker baixa
 * o buffer e envia pelo chip (dispatchManualReplyJob). `caption` é a legenda
 * opcional (vira o texto/content do job).
 */
export async function enqueueManualMedia(
  lead: { id: string; phone: string; userId: string; whatsAppNumberId?: string | null },
  media: OutboundMedia,
  opts: { caption?: string; replyToMessageId?: string | null } = {},
): Promise<void> {
  const numberId = await resolveReplyChip(lead.userId, lead.whatsAppNumberId ?? null);
  if (!numberId) throw new Error("sem número Baileys disponível p/ responder");
  await prisma.outboundJob.create({
    data: {
      leadId: lead.id,
      kind: MANUAL_REPLY_KIND,
      content: opts.caption ?? "", // legenda (pode ser vazia)
      status: "PENDING",
      whatsAppNumberId: numberId,
      scheduledFor: new Date(),
      replyToMessageId: opts.replyToMessageId ?? null,
      mediaPath: media.mediaPath,
      mediaType: media.mediaType,
      mediaMime: media.mediaMime,
      fileName: media.fileName,
    },
  });
}

/**
 * Worker: envia uma resposta manual enfileirada pelo chip do lead e persiste o
 * Message(OUTBOUND). Rodado por processManualReplies (que faz o claim atômico).
 * Não aplica rodapé, não muda o status do lead nem respeita janela/cap — é uma
 * resposta reativa de conversa, não um disparo. Notifica a aba via SSE.
 */
export async function dispatchManualReplyJob(jobId: string): Promise<void> {
  const job = await prisma.outboundJob.findUnique({
    where: { id: jobId },
    include: { lead: { select: { id: true, phone: true, userId: true } } },
  });
  if (!job || !job.lead || (job.kind !== MANUAL_REPLY_KIND && job.kind !== SYSTEM_MESSAGE_KIND))
    return;
  // Notificação do sistema (confirmação) → SYSTEM; resposta do operador → OPERATOR.
  const source: MessageSource = job.kind === SYSTEM_MESSAGE_KIND ? "SYSTEM" : "OPERATOR";

  const pool = await loadPool();
  // Chip de envio: o do job; se o socket não estiver vivo neste worker (o reaper
  // zerou ao recuperar um órfão, ou o chip caiu), re-resolve p/ qualquer chip da
  // conta COM socket vivo. Sem socket vivo nenhum → lança (retry no próximo tick).
  let numberId: string | null = job.whatsAppNumberId;
  if (!numberId || !pool.hasLiveSocket(numberId)) {
    const chips = await prisma.whatsAppNumber.findMany({
      where: { userId: job.lead.userId, status: { in: ["CONNECTED", "WARMING"] } },
      select: { id: true },
    });
    numberId = chips.find((c) => pool.hasLiveSocket(c.id))?.id ?? null;
  }
  if (!numberId) throw new Error("sem número Baileys vivo p/ a resposta manual");

  // Citação (reply): resolve a msg original p/ montar o `quoted` do Baileys e
  // gravar o vínculo (replyToId) na resposta. null se o job não cita nada.
  const quoted = await resolveQuotedRef(job.lead.id, job.replyToMessageId ?? null);

  // Anexo: o web subiu ao storage (job.mediaPath). Baixa o buffer p/ enviar pelo
  // chip. Falha de download → lança (retry no próximo tick, sem perder o job).
  let media: SendMedia | null = null;
  if (job.mediaPath && job.mediaType) {
    const buffer = await downloadMediaBuffer(job.mediaPath);
    if (!buffer) throw new Error("falha ao baixar anexo do storage p/ envio");
    media = {
      buffer,
      mediaType: job.mediaType as SendMedia["mediaType"],
      mime: job.mediaMime ?? "application/octet-stream",
      fileName: job.fileName ?? undefined,
    };
  }

  const out = await pool.send(numberId, job.lead.phone, job.content, quoted?.quote, media);
  if (!out.ok) throw new Error(`baileys reply falhou: ${out.reason}`);

  // content da Message: legenda quando houver; anexo sem legenda → placeholder
  // ("📷 Imagem") p/ a bolha ter algo e o filtro de contexto da IA descartar.
  const storedContent =
    media && !job.content.trim() ? MEDIA_TYPE_PLACEHOLDER[media.mediaType] : job.content;

  await prisma.$transaction([
    prisma.message.create({
      data: {
        leadId: job.lead.id,
        direction: "OUTBOUND",
        content: storedContent,
        providerMessageId: out.providerMessageId,
        status: "SENT",
        whatsAppNumberId: numberId,
        replyToId: quoted?.messageId ?? null,
        source, // OPERATOR (resposta manual) ou SYSTEM (notificação transacional)
        ...(media
          ? {
              mediaPath: job.mediaPath,
              mediaType: job.mediaType,
              mediaMime: job.mediaMime,
              fileName: job.fileName,
            }
          : {}),
      },
    }),
    prisma.outboundJob.update({
      where: { id: jobId },
      data: { status: "SENT", sentAt: new Date(), whatsAppNumberId: numberId, deferCount: 0 },
    }),
    prisma.lead.update({ where: { id: job.lead.id }, data: { updatedAt: new Date() } }),
  ]);
  await invalidateConversation(job.lead.id); // OUTBOUND novo → contexto da IA mudou
  // notifica a aba do operador p/ a thread refletir a mensagem enviada
  await publishTenantEvent(job.lead.userId, { type: "conversation:changed", leadId: job.lead.id });
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

  // Corpo enviado = conteúdo renderizado + rodapé de descadastro (LGPD). O texto
  // gravado em Message reflete exatamente o que saiu (auditoria).
  const body = withOptOutFooter(job.content);

  // ── Baileys (multi-número) ──────────────────────────────────────────────
  if (env.WHATSAPP_MODE === "baileys") {
    const numberId = opts.numberId;
    if (!numberId) throw new Error("Baileys exige numberId (rotação no worker)");

    const { send: poolSend } = await loadPool();

    // simula digitação proporcional ANTES de enviar
    await sleep(
      typingDelayMs(body.length, {
        msPerChar: env.BAILEYS_TYPING_MS_PER_CHAR,
        maxMs: env.BAILEYS_TYPING_MAX_MS,
      }),
    );

    // O send() resolve o JID canônico (corrige o 9º dígito BR) e já aplica o
    // gate anti-spam (BAILEYS_ONWHATSAPP_CHECK). Número fora do WhatsApp → cancela.
    const out = await poolSend(numberId, lead.phone, body);
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
          content: body,
          providerMessageId: out.providerMessageId,
          status: "SENT",
          whatsAppNumberId: numberId,
          source: "CAMPAIGN", // disparo de campanha (template/freeform)
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

  // ── mock / cloud-api (caminho original) ─────────────────────────────────
  const wa = getWhatsApp();
  let providerMessageId: string;
  let sentContent = job.content; // template aprovado não recebe rodapé
  if (job.kind === "template" && env.WHATSAPP_TEMPLATE_NAME && wa.mode === "cloud-api") {
    const res = await wa.sendTemplate(
      lead.phone,
      job.templateName || env.WHATSAPP_TEMPLATE_NAME,
      env.WHATSAPP_TEMPLATE_LANG,
      [lead.name],
    );
    providerMessageId = res.providerMessageId;
  } else {
    // mock OU freeform: conteúdo renderizado + rodapé de descadastro
    sentContent = body;
    const res = await wa.sendMessage(lead.phone, sentContent);
    providerMessageId = res.providerMessageId;
  }

  await prisma.$transaction([
    prisma.message.create({
      data: {
        leadId: lead.id,
        direction: "OUTBOUND",
        content: sentContent,
        providerMessageId,
        status: "SENT",
        source: "CAMPAIGN", // disparo de campanha (template/freeform)
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
