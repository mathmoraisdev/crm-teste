import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import path from "node:path";
import pino from "pino";
import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";
import { classifyDisconnect } from "./bansignals";
import { useDbAuthState } from "./authstate";
import { jidOf, pickSendJid } from "./jid";
import { isMediaMessage, mediaPlaceholder, downloadableMedia, mediaCaption } from "./media";
import { shouldTranscribe } from "@/server/ai/transcribe-policy";

const logger = pino({ level: "warn" });

export interface InboundEvent {
  fromPhone: string; // E.164 com "+"
  text: string;
  providerMessageId: string | null;
  whatsAppNumberId: string;
  /** Se o lead citou uma mensagem (reply), o id WA da citada (contextInfo.stanzaId). */
  quotedProviderMessageId?: string | null;
}
/** Mensagem `fromMe` digitada por humano (não pelo bot) — handoff manual pelo zap. */
export interface OperatorEvent {
  toPhone: string; // destinatário (lead), E.164 com "+"
  text: string;
  providerMessageId: string | null;
  whatsAppNumberId: string;
}
/** Mídia `fromMe` (não do bot): o operador respondeu com ARQUIVO pelo próprio
 *  WhatsApp do número. Espelha InboundMediaEvent, mas vira OUTBOUND no CRM. */
export interface OperatorMediaEvent {
  toPhone: string; // destinatário (lead), E.164 com "+"
  placeholder: string; // rótulo legível ("📷 Imagem")
  providerMessageId: string | null;
  whatsAppNumberId: string;
  /** legenda que o operador digitou junto do arquivo (imagem/vídeo/doc), se houver. */
  caption?: string | null;
  // Anexo baixado (imagem/áudio/PDF); ausente p/ tipos que não baixamos:
  buffer?: Buffer;
  mediaType?: "image" | "audio" | "document";
  mime?: string;
  fileName?: string;
}
/** Mídia recebida do lead (sem legenda) — vira placeholder no inbox, sem IA.
 *  Para imagem/documento, anexa o arquivo baixado (buffer + metadados) p/ o
 *  serviço subir ao storage; os campos de mídia ficam ausentes p/ tipos que não
 *  baixamos (áudio/vídeo/etc.), que seguem só como placeholder. */
export interface InboundMediaEvent {
  fromPhone: string; // E.164 com "+"
  placeholder: string; // rótulo legível ("📷 Imagem")
  providerMessageId: string | null;
  whatsAppNumberId: string;
  // Anexo baixado (imagem/áudio/PDF):
  buffer?: Buffer;
  mediaType?: "image" | "audio" | "document";
  mime?: string;
  fileName?: string;
  audioSeconds?: number | null; // duração da nota de voz (guardrail de áudio longo)
}
export type SendOutcome =
  | { ok: true; providerMessageId: string }
  | { ok: false; reason: "no_socket" | "not_on_whatsapp" | "send_failed" };

type Handlers = {
  onInbound: (e: InboundEvent) => Promise<void>;
  onAck: (providerMessageId: string, status: "DELIVERED" | "READ") => Promise<void>;
  /** opcional: mensagem manual do operador (fromMe não-bot) → handoff automático. */
  onOperatorMessage?: (e: OperatorEvent) => Promise<void>;
  /** opcional: mídia do lead sem legenda → persiste placeholder no inbox (sem IA). */
  onInboundMedia?: (e: InboundMediaEvent) => Promise<void>;
  /** opcional: arquivo enviado pelo operador pelo próprio zap → OUTBOUND no CRM. */
  onOperatorMedia?: (e: OperatorMediaEvent) => Promise<void>;
};

const sockets = new Map<string, WASocket>();
const connecting = new Set<string>(); // lock síncrono contra conexão duplicada (race reconnect × ensure)
let handlers: Handlers | null = null;

export function registerHandlers(h: Handlers) {
  handlers = h;
}

// Ids das mensagens que o PRÓPRIO bot enviou. O WhatsApp ecoa todo envio de volta
// como `fromMe` no messages.upsert — sem isto, o eco do bot seria confundido com
// uma resposta manual do operador e auto-pausaria a IA. Registrado de forma
// SÍNCRONA no send() (antes de qualquer eco chegar) e limpo após 60s.
const sentByBot = new Set<string>();
function rememberBotSent(id: string) {
  sentByBot.add(id);
  setTimeout(() => sentByBot.delete(id), 60_000).unref?.();
}

// Anti-spam: avisa "só leio texto" no máx. 1x por lead a cada 5 min, p/ não
// responder a cada arquivo de uma rajada de mídias.
const mediaNoticeCooldown = new Set<string>();
const MEDIA_NOTICE =
  "Por enquanto só consigo ler mensagens de texto 🙏 Pode me escrever a sua dúvida?";
async function replyUnsupportedMedia(numberId: string, phone: string, label: string) {
  const key = `${numberId}:${phone}`;
  if (mediaNoticeCooldown.has(key)) return;
  mediaNoticeCooldown.add(key); // síncrono, antes do await: trava a rajada
  setTimeout(() => mediaNoticeCooldown.delete(key), 5 * 60_000).unref?.();
  const r = await send(numberId, phone, MEDIA_NOTICE);
  if (!r.ok) {
    console.warn(`[baileys] "${label}" falha ao avisar mídia não suportada p/ ${phone}: ${r.reason}`);
  }
}

// Teto de tamanho p/ baixar mídia do lead. Acima disto cai no placeholder (sem
// download) — protege memória do worker e custo de storage/egress.
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB

/** Baixa o binário de uma mídia (imagem/PDF) do lead, ou null se exceder o teto
 *  ou falhar. Falha NÃO interrompe o inbound: o placeholder ainda é registrado. */
async function tryDownloadMedia(
  sock: WASocket,
  m: WAMessage,
  dl: { mediaType: string; mime: string },
  label: string,
): Promise<Buffer | null> {
  try {
    const buf = (await downloadMediaMessage(
      m,
      "buffer",
      {},
      { logger, reuploadRequest: sock.updateMediaMessage },
    )) as Buffer;
    if (buf.length > MAX_MEDIA_BYTES) {
      console.warn(
        `[baileys] "${label}" mídia ${dl.mediaType} (${buf.length}B) acima do teto — só placeholder.`,
      );
      return null;
    }
    return buf;
  } catch (err) {
    console.warn(
      `[baileys] "${label}" falha ao baixar mídia ${dl.mediaType}: ${(err as Error).message}`,
    );
    return null;
  }
}

/** Sobe (ou ressuscita) o socket de UM número e persiste estado/eventos. */
export async function connectNumber(numberId: string): Promise<void> {
  // lock contra conexão duplicada (já conectado ou conectando agora).
  if (sockets.has(numberId) || connecting.has(numberId)) return;
  connecting.add(numberId);
  try {
    const rec = await prisma.whatsAppNumber.findUnique({ where: { id: numberId } });
    // DESLOGADO/BANIDO/DESATIVADO não sobem socket sozinhos: o deslogado precisa
    // do "Reconectar" (que apaga as creds mortas e volta p/ CONNECTING) antes.
    if (!rec || rec.status === "DISABLED" || rec.status === "BANNED" || rec.status === "LOGGED_OUT") return;

    // Auth-state: por padrão no Postgres (sobrevive a redeploys do Railway,
    // que zeram o disco). BAILEYS_AUTH_STORE="file" volta ao comportamento
    // antigo (arquivos em BAILEYS_AUTH_DIR). Aqui o número já existe no banco
    // (findUnique acima), então o caminho "db" é sempre seguro.
    const { state, saveCreds } =
      env.BAILEYS_AUTH_STORE === "file"
        ? await useMultiFileAuthState(path.join(env.BAILEYS_AUTH_DIR, rec.sessionDir))
        : await useDbAuthState(rec.id);
    // usa a versão ATUAL do WhatsApp Web — versão chumbada/velha causa rejeição
    // (Connection Failure 405) no pareamento. Cai no default do Baileys se falhar.
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        // Embrulha o key store no cache do Baileys: habilita keys.transaction
        // (atomicidade + write-through em memória) que o repositório Signal usa
        // a cada mensagem. Sem isso, get/set viram round-trips independentes no
        // Postgres e o ratchet dessincroniza após o 1º inbound — a 2ª resposta
        // sai cifrada com estado defasado e o lead vê "Aguardando mensagem".
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: ["MiniCRM", "Chrome", "1.0"],
      // Quando o WhatsApp pede o reenvio de uma mensagem nossa (retry receipt),
      // o Baileys chama getMessage. Sem isso ele não reenvia, e o cliente do
      // outro lado acaba resetando a sessão Signal repetidas vezes ("Closing
      // open session in favor of incoming prekey bundle") — o que corrompe a
      // sessão e faz as respostas do lead falharem na descriptografia. Buscamos
      // o conteúdo já persistido pelo providerMessageId.
      getMessage: async (key) => {
        if (!key.id) return undefined;
        // findFirst: providerMessageId não é mais único globalmente (unique por
        // lead). O conteúdo é idêntico entre cópias, então qualquer match serve
        // p/ o reenvio (retry receipt) do Baileys.
        const msg = await prisma.message.findFirst({
          where: { providerMessageId: key.id },
          select: { content: true },
        });
        return msg ? { conversation: msg.content } : undefined;
      },
    });
    sockets.set(numberId, sock);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    if (u.qr) {
      console.log(`\n[baileys] escaneie o QR do número "${rec.label}":\n`);
      qrcode.generate(u.qr, { small: true });
      // grava o QR no banco p/ a UI renderizar (pareamento por QR no app)
      await prisma.whatsAppNumber
        .update({ where: { id: numberId }, data: { pairingQr: u.qr } })
        .catch(() => {});
    }
    if (u.connection === "open") {
      await prisma.whatsAppNumber.update({
        where: { id: numberId },
        data: { status: "CONNECTED", connectedAt: new Date(), lastError: null, pairingQr: null },
      });
      console.log(`[baileys] "${rec.label}" conectado.`);
    }
    if (u.connection === "close") {
      const code = (u.lastDisconnect?.error as Boom)?.output?.statusCode;
      const action = classifyDisconnect(code);
      sockets.delete(numberId);
      if (action === "BANNED") {
        await prisma.whatsAppNumber.update({
          where: { id: numberId },
          data: { status: "BANNED", bannedAt: new Date(), lastError: `code=${code}` },
        });
        const { rerouteJobsFromNumber } = await import("@/server/worker/reroute");
        const moved = await rerouteJobsFromNumber(numberId, new Date());
        console.error(`[baileys] "${rec.label}" BANIDO (code=${code}) — ${moved} jobs reroteados, fora da rotação.`);
      } else if (action === "LOGGED_OUT") {
        // 401: aparelho deslogado. As credenciais morreram — NÃO reconecta sozinho
        // (reusar a sessão derrubada só re-derruba em 401). Fica DESLOGADO até o
        // operador clicar "Reconectar" (apaga as creds → QR novo). As configs do
        // número (system prompt, modelo, etc.) ficam intactas em outra tabela.
        await prisma.whatsAppNumber.update({
          where: { id: numberId },
          data: { status: "LOGGED_OUT", lastError: `code=${code}`, pairingQr: null },
        });
        const { rerouteJobsFromNumber } = await import("@/server/worker/reroute");
        const moved = await rerouteJobsFromNumber(numberId, new Date());
        console.warn(`[baileys] "${rec.label}" deslogado (code=${code}) — ${moved} jobs reroteados. Use "Reconectar" p/ reescanear (configs preservadas).`);
      } else if (action === "RECONNECT" && code !== DisconnectReason.loggedOut) {
        console.warn(`[baileys] "${rec.label}" caiu (code=${code}) — reconectando…`);
        setTimeout(() => void connectNumber(numberId), 5000);
      } else {
        await prisma.whatsAppNumber.update({
          where: { id: numberId },
          data: { status: "DISABLED", lastError: `fatal code=${code}` },
        });
      }
    }
  });

  // Inbound → handler de domínio (handleInbound)
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (!handlers) return;
    for (const m of messages) {
      const remoteJid = m.key.remoteJid ?? "";
      // Baileys 7 endereça DMs por LID (@lid) OU por telefone (@s.whatsapp.net).
      // O guard antigo exigia @s.whatsapp.net e descartava TODO inbound LID antes
      // do trace — a resposta do lead sumia sem rastro e a IA nunca era acionada.
      // Aceita os dois; grupos/broadcast/status/newsletter continuam ignorados.
      const isDM = remoteJid.endsWith("@s.whatsapp.net") || remoteJid.endsWith("@lid");
      if (!isDM) continue;
      // fromMe = mensagem saindo deste número: ou o eco do próprio bot, ou o
      // operador respondendo manual pelo zap. Tratada abaixo (handoff automático).
      const fromMe = !!m.key.fromMe;

      // Telefone real (E.164) p/ casar o lead: se o inbound veio por LID, o número
      // de telefone (PN) está em remoteJidAlt. Sem PN não dá p/ achar o lead por
      // telefone — só o id LID, que não bate com o phone salvo.
      const altJid = m.key.remoteJidAlt ?? "";
      const pnJid = remoteJid.endsWith("@s.whatsapp.net")
        ? remoteJid
        : altJid.endsWith("@s.whatsapp.net")
          ? altJid
          : null;

      // O conteúdo pode vir ANINHADO: conversa com mensagens temporárias
      // (ephemeralMessage), view-once, ou doc-com-legenda. Sem desaninhar, o
      // texto "some" e a IA nunca é acionada (silêncio sem erro). Desce um nível.
      const msg = m.message;
      const inner =
        msg?.ephemeralMessage?.message ??
        msg?.viewOnceMessage?.message ??
        msg?.viewOnceMessageV2?.message ??
        msg?.documentWithCaptionMessage?.message ??
        msg ??
        null;
      const text =
        inner?.conversation ?? inner?.extendedTextMessage?.text ?? "";
      // Reply/citação: o id WA da mensagem citada vem no contextInfo (só presente
      // em extendedTextMessage — texto puro não cita). Usado p/ ligar a resposta
      // à msg original no inbox (resolvido por providerMessageId no ingest).
      const quotedProviderMessageId =
        inner?.extendedTextMessage?.contextInfo?.stanzaId ?? null;

      // TRACE: mostra type, JID cru + alt + PN resolvido, campos e texto — pra
      // flagrar mensagem descartada antes da IA (LID sem PN, type != notify, etc).
      console.log(
        `[inbound] type=${type} fromMe=${fromMe} de=${remoteJid} alt=${altJid || "—"} pn=${pnJid ?? "SEM_PN"} ` +
          `campos=${msg ? Object.keys(msg).join("|") : "SEM_MESSAGE"} ` +
          `text="${text.slice(0, 40)}"`,
      );

      if (type !== "notify") continue; // history/append não aciona a IA
      if (!text) {
        if (!msg && !fromMe) {
          console.warn(
            `[baileys] "${rec.label}" inbound NÃO descriptografado de ${remoteJid} (id=${m.key.id} stub=${m.messageStubType ?? "—"}) — mensagem perdida.`,
          );
        } else if (!fromMe && pnJid && isMediaMessage(inner)) {
          // Mídia de um lead (sem legenda). A IA não lê o arquivo, mas para
          // imagem/PDF nós o BAIXAMOS para o operador acessar no inbox (download).
          // Demais tipos seguem só como placeholder. Em ambos avisamos o lead que
          // só lemos texto (anti-spam: 1x a cada 5 min).
          const phone = `+${pnJid.split("@")[0]}`;
          const placeholder = mediaPlaceholder(inner);
          const audioSeconds = (inner as any)?.audioMessage?.seconds ?? null;
          if (placeholder) {
            const dl = downloadableMedia(inner);
            const file = dl ? await tryDownloadMedia(sock, m, dl, rec.label) : null;
            await handlers.onInboundMedia?.({
              fromPhone: phone,
              placeholder,
              providerMessageId: m.key.id ?? null,
              whatsAppNumberId: numberId,
              audioSeconds,
              ...(file && dl
                ? {
                    buffer: file,
                    mediaType: dl.mediaType,
                    mime: dl.mime,
                    fileName: dl.fileName,
                  }
                : {}),
            });
            // Áudio curto elegível → não avisa (a IA vai responder). Áudio longo
            // ou não transcritível → mantém o "só leio texto" de sempre.
            // `shouldTranscribe` é fonte única da verdade: mesmo predicado aqui
            // (decide o aviso) e no serviço (decide transcrever) — sem divergência.
            const willTranscribe =
              dl?.mediaType === "audio" &&
              !!file &&
              shouldTranscribe(
                { seconds: audioSeconds },
                { enabled: env.TRANSCRIBE_ENABLED, maxSeconds: env.TRANSCRIBE_MAX_SECONDS },
              );
            if (!willTranscribe) {
              await replyUnsupportedMedia(numberId, phone, rec.label);
            }
          } else {
            await replyUnsupportedMedia(numberId, phone, rec.label);
          }
        } else if (fromMe && pnJid && isMediaMessage(inner)) {
          // Operador respondeu com ARQUIVO pelo próprio WhatsApp (fromMe). Espelha
          // o download do inbound, mas grava OUTBOUND (histórico do CRM); NÃO avisa
          // "só leio texto" nem transcreve — é resposta humana, não uma pergunta.
          // Ecos do nosso próprio envio de mídia (fila de saída) já vêm marcados
          // em sentByBot → não duplica.
          if (!(m.key.id && sentByBot.has(m.key.id))) {
            const phone = `+${pnJid.split("@")[0]}`;
            const placeholder = mediaPlaceholder(inner);
            if (placeholder) {
              const dl = downloadableMedia(inner);
              const file = dl ? await tryDownloadMedia(sock, m, dl, rec.label) : null;
              await handlers.onOperatorMedia?.({
                toPhone: phone,
                placeholder,
                providerMessageId: m.key.id ?? null,
                whatsAppNumberId: numberId,
                caption: mediaCaption(inner), // legenda digitada junto do arquivo
                ...(file && dl
                  ? {
                      buffer: file,
                      mediaType: dl.mediaType,
                      mime: dl.mime,
                      fileName: dl.fileName,
                    }
                  : {}),
              });
            }
          }
        }
        continue;
      }
      if (!pnJid) {
        // Sem o PN (LID sem alt): não temos o telefone p/ casar o lead.
        // Logar é melhor que o silêncio — sinaliza que precisamos do mapa LID→PN.
        if (!fromMe) {
          console.warn(
            `[baileys] "${rec.label}" inbound LID sem PN (de=${remoteJid}) — sem telefone p/ casar o lead.`,
          );
        }
        continue;
      }

      // fromMe: eco do bot vs. resposta manual do operador. O eco já está no
      // sentByBot (registrado no send) → ignora. O resto é humano → handoff.
      if (fromMe) {
        if (m.key.id && sentByBot.has(m.key.id)) continue; // nosso próprio envio
        await handlers.onOperatorMessage?.({
          toPhone: `+${pnJid.split("@")[0]}`,
          text,
          providerMessageId: m.key.id ?? null,
          whatsAppNumberId: numberId,
        });
        continue;
      }

      await handlers.onInbound({
        fromPhone: `+${pnJid.split("@")[0]}`,
        text,
        providerMessageId: m.key.id ?? null,
        whatsAppNumberId: numberId,
        quotedProviderMessageId,
      });
    }
  });

  // Acks de entrega/leitura → Message.status
  sock.ev.on("messages.update", async (updates) => {
    if (!handlers) return;
    for (const up of updates) {
      const s = up.update?.status;
      if (!up.key.id) continue;
      if (s === 3 /* DELIVERY_ACK */) await handlers.onAck(up.key.id, "DELIVERED");
      else if (s === 4 /* READ */) await handlers.onAck(up.key.id, "READ");
    }
  });
  } finally {
    connecting.delete(numberId);
  }
}

/**
 * Resolve o JID canônico consultando o WhatsApp. `exists`:
 *  - true/false → o WhatsApp respondeu (conta existe ou não);
 *  - null       → a consulta falhou (rede/limite); usamos o fallback e NÃO
 *                 bloqueamos o envio por causa de um erro de lookup.
 */
async function resolveJid(
  sock: WASocket,
  phone: string,
): Promise<{ exists: boolean | null; jid: string }> {
  const fallback = jidOf(phone);
  try {
    const res = await sock.onWhatsApp(fallback);
    return pickSendJid(fallback, res);
  } catch {
    return { exists: null, jid: fallback };
  }
}

/** Envia com simulação humana (presence/typing). NÃO faz o delay de digitação
 *  aqui — quem chama (messaging) controla o sleep p/ manter a lógica testável.
 *  O JID de destino é o CANÔNICO do WhatsApp (corrige o 9º dígito BR). */
/** Citação (reply): reconstruída a partir do que persistimos da msg original.
 *  `id` = providerMessageId (= key.id do WA), `fromMe` = se foi nossa (OUTBOUND),
 *  `text` = conteúdo p/ o preview da citação. Suficiente p/ o Baileys montar o
 *  contextInfo — não precisa da WAMessage "viva". */
export interface QuotedRef {
  id: string;
  text: string;
  fromMe: boolean;
}

/** Anexo de saída (imagem/documento/áudio) p/ o envio pelo chip. */
export interface SendMedia {
  buffer: Buffer;
  mediaType: "image" | "document" | "audio";
  mime: string;
  fileName?: string;
}

/** Monta o conteúdo de mídia do Baileys. `caption` = texto (legenda); áudio não
 *  suporta legenda. Documento precisa de fileName p/ o WhatsApp exibir o nome. */
function baileysMediaContent(media: SendMedia, caption?: string) {
  const mimetype = media.mime;
  if (media.mediaType === "image") return { image: media.buffer, mimetype, caption };
  if (media.mediaType === "audio") return { audio: media.buffer, mimetype };
  return {
    document: media.buffer,
    mimetype,
    fileName: media.fileName ?? "arquivo",
    caption,
  };
}

export async function send(
  numberId: string,
  phone: string,
  text: string,
  quoted?: QuotedRef | null,
  media?: SendMedia | null,
): Promise<SendOutcome> {
  const sock = sockets.get(numberId);
  if (!sock) return { ok: false, reason: "no_socket" };
  const { exists, jid } = await resolveJid(sock, phone);
  // Gate anti-spam: só bloqueia quando a checagem está ligada E o WhatsApp
  // respondeu explicitamente que o número NÃO existe (exists === false).
  // Erro de lookup (exists === null) não bloqueia — envia pelo fallback.
  if (exists === false && env.BAILEYS_ONWHATSAPP_CHECK) {
    return { ok: false, reason: "not_on_whatsapp" };
  }
  try {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    return await new Promise<SendOutcome>((resolve) => {
      // pequeno "digitando" curto aqui; o delay maior fica no chamador
      setTimeout(async () => {
        try {
          await sock.sendPresenceUpdate("paused", jid).catch(() => {});
          // WAMessage mínima p/ citar: o Baileys só lê key (stanzaId/fromMe) e
          // message (preview). Reconstruída do que guardamos — sem buscar a viva.
          const quotedMsg = quoted
            ? {
                key: { remoteJid: jid, fromMe: quoted.fromMe, id: quoted.id },
                message: { conversation: quoted.text },
              }
            : undefined;
          // Mídia → conteúdo de anexo (texto vira legenda); senão texto puro.
          const caption = text?.trim() ? text : undefined;
          const content = media ? baileysMediaContent(media, caption) : { text };
          const r = await sock.sendMessage(
            jid,
            content,
            quotedMsg ? { quoted: quotedMsg } : undefined,
          );
          // marca SÍNCRONO o id do nosso envio antes do eco fromMe chegar, p/ não
          // confundir com resposta manual do operador (auto-pause indevido).
          if (r?.key?.id) rememberBotSent(r.key.id);
          resolve({ ok: true, providerMessageId: r?.key?.id ?? `baileys-${numberId}` });
        } catch {
          resolve({ ok: false, reason: "send_failed" });
        }
      }, 400);
    });
  } catch {
    return { ok: false, reason: "send_failed" };
  }
}

/** Sobe todos os números não banidos/desabilitados (chamado no boot do worker). */
export async function connectAll(): Promise<void> {
  const nums = await prisma.whatsAppNumber.findMany({
    where: { status: { notIn: ["BANNED", "DISABLED", "LOGGED_OUT"] } },
    select: { id: true },
  });
  for (const n of nums) await connectNumber(n.id);
}

/**
 * Conecta números elegíveis que AINDA não têm socket vivo neste processo —
 * inclui chips recém-criados pela UI (pareamento por QR) sem precisar reiniciar
 * o worker. Idempotente: pula quem já tem socket (evita conexão duplicada).
 */
export async function ensureConnections(): Promise<void> {
  const nums = await prisma.whatsAppNumber.findMany({
    where: { status: { notIn: ["BANNED", "DISABLED", "LOGGED_OUT"] } },
    select: { id: true },
  });
  for (const n of nums) if (!sockets.has(n.id)) await connectNumber(n.id);
}

export function hasLiveSocket(numberId: string): boolean {
  return sockets.has(numberId);
}
