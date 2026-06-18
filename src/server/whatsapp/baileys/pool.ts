import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import path from "node:path";
import pino from "pino";
import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";
import { classifyDisconnect } from "./bansignals";

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

const jidOf = (phone: string) => `${phone.replace(/^\+/, "")}@s.whatsapp.net`;

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

    const dir = path.join(env.BAILEYS_AUTH_DIR, rec.sessionDir);
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const sock = makeWASocket({ auth: state, logger, browser: ["MiniCRM", "Chrome", "1.0"] });
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
        console.error(`[baileys] "${rec.label}" BANIDO/deslogado (code=${code}) — fora da rotação.`);
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

/** Verifica se o número existe no WhatsApp (sinal anti-spam). */
export async function isOnWhatsApp(numberId: string, phone: string): Promise<boolean> {
  const sock = sockets.get(numberId);
  if (!sock) return false;
  const res = await sock.onWhatsApp(jidOf(phone)).catch(() => []);
  return !!res?.[0]?.exists;
}

/** Envia com simulação humana (presence/typing). NÃO faz o delay de digitação
 *  aqui — quem chama (messaging) controla o sleep p/ manter a lógica testável. */
export async function send(
  numberId: string,
  phone: string,
  text: string,
): Promise<SendOutcome> {
  const sock = sockets.get(numberId);
  if (!sock) return { ok: false, reason: "no_socket" };
  const jid = jidOf(phone);
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
