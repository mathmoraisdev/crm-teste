import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
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

const logger = pino({ level: "warn" });

export interface InboundEvent {
  fromPhone: string; // E.164 com "+"
  text: string;
  providerMessageId: string | null;
  whatsAppNumberId: string;
}
export type SendOutcome =
  | { ok: true; providerMessageId: string }
  | { ok: false; reason: "no_socket" | "not_on_whatsapp" | "send_failed" };

type Handlers = {
  onInbound: (e: InboundEvent) => Promise<void>;
  onAck: (providerMessageId: string, status: "DELIVERED" | "READ") => Promise<void>;
};

const sockets = new Map<string, WASocket>();
const connecting = new Set<string>(); // lock síncrono contra conexão duplicada (race reconnect × ensure)
let handlers: Handlers | null = null;

export function registerHandlers(h: Handlers) {
  handlers = h;
}

/** Sobe (ou ressuscita) o socket de UM número e persiste estado/eventos. */
export async function connectNumber(numberId: string): Promise<void> {
  // lock contra conexão duplicada (já conectado ou conectando agora).
  if (sockets.has(numberId) || connecting.has(numberId)) return;
  connecting.add(numberId);
  try {
    const rec = await prisma.whatsAppNumber.findUnique({ where: { id: numberId } });
    if (!rec || rec.status === "DISABLED" || rec.status === "BANNED") return;

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
    const sock = makeWASocket({ version, auth: state, logger, browser: ["MiniCRM", "Chrome", "1.0"] });
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
        console.error(`[baileys] "${rec.label}" BANIDO/deslogado (code=${code}) — ${moved} jobs reroteados, fora da rotação.`);
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
    if (type !== "notify" || !handlers) return;
    for (const m of messages) {
      if (m.key.fromMe || !m.key.remoteJid?.endsWith("@s.whatsapp.net")) continue;
      const text =
        m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? "";
      if (!text) continue;
      await handlers.onInbound({
        fromPhone: `+${m.key.remoteJid.split("@")[0]}`,
        text,
        providerMessageId: m.key.id ?? null,
        whatsAppNumberId: numberId,
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
export async function send(
  numberId: string,
  phone: string,
  text: string,
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
          const r = await sock.sendMessage(jid, { text });
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
    where: { status: { notIn: ["BANNED", "DISABLED"] } },
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
    where: { status: { notIn: ["BANNED", "DISABLED"] } },
    select: { id: true },
  });
  for (const n of nums) if (!sockets.has(n.id)) await connectNumber(n.id);
}

export function hasLiveSocket(numberId: string): boolean {
  return sockets.has(numberId);
}
