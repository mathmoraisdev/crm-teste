// Mídia (áudio/imagem/vídeo/doc/figurinha...) ainda não é lida pela IA: o inbound
// chega sem texto e seria descartado em silêncio. Esta detecção pura permite que o
// handler avise o lead ("só leio texto") em vez de ficar mudo.

/** Chaves de conteúdo do Baileys que representam mídia (não-texto). */
export const MEDIA_KEYS = [
  "imageMessage",
  "audioMessage",
  "videoMessage",
  "documentMessage",
  "stickerMessage",
  "ptvMessage", // vídeo redondo (push-to-video)
  "contactMessage",
  "locationMessage",
] as const;

/** true se o conteúdo (já desaninhado) for uma mensagem de mídia conhecida. */
export function isMediaMessage(inner: unknown): boolean {
  if (!inner || typeof inner !== "object") return false;
  return MEDIA_KEYS.some((k) => k in (inner as Record<string, unknown>));
}

/** Strings de placeholder — FONTE ÚNICA, referenciada pelos dois formatos de
 *  inbound (Baileys e Cloud API) e pelo filtro de contexto da IA. */
const PH = {
  image: "📷 Imagem",
  audio: "🎤 Áudio",
  video: "🎥 Vídeo",
  document: "📎 Documento",
  sticker: "✨ Figurinha",
  contact: "👤 Contato",
  location: "📍 Localização",
} as const;

/** Rótulo p/ cada chave de conteúdo do Baileys. */
const MEDIA_LABELS: Record<(typeof MEDIA_KEYS)[number], string> = {
  imageMessage: PH.image,
  audioMessage: PH.audio,
  videoMessage: PH.video,
  ptvMessage: PH.video,
  documentMessage: PH.document,
  stickerMessage: PH.sticker,
  contactMessage: PH.contact,
  locationMessage: PH.location,
};

/** Rótulo p/ o `msg.type` do Graph API (Cloud API) — formato distinto do Baileys. */
const CLOUD_MEDIA_LABELS: Record<string, string> = {
  image: PH.image,
  audio: PH.audio,
  voice: PH.audio,
  video: PH.video,
  document: PH.document,
  sticker: PH.sticker,
  location: PH.location,
  contacts: PH.contact,
};

/** Placeholder textual da mídia Baileys (1º tipo conhecido) ou null se `inner` não
 *  for mídia. Persistido como `content` da Message só p/ o operador ver no inbox
 *  que algo chegou — não baixamos nem armazenamos o arquivo. */
export function mediaPlaceholder(inner: unknown): string | null {
  if (!inner || typeof inner !== "object") return null;
  for (const k of MEDIA_KEYS) {
    if (k in (inner as Record<string, unknown>)) return MEDIA_LABELS[k];
  }
  return null;
}

/** Placeholder p/ o tipo de mídia do Graph API (Cloud API), ou null se for
 *  texto/tipo desconhecido. */
export function cloudApiMediaPlaceholder(type: string): string | null {
  return CLOUD_MEDIA_LABELS[type] ?? null;
}

/** Conjunto dos placeholders — usado p/ EXCLUÍ-los do contexto da IA (a IA não lê
 *  mídia; o placeholder é puramente visual p/ o operador, não gasta token). */
export const MEDIA_PLACEHOLDERS: ReadonlySet<string> = new Set(Object.values(PH));

// ─────────────────────────────────────────────────────────────
// Mídia BAIXÁVEL (escopo atual: só imagem e documento/PDF).
// Áudio/vídeo/figurinha/contato/localização seguem só como placeholder.
// ─────────────────────────────────────────────────────────────

/** Metadados extraídos de uma mídia baixável do Baileys. */
export interface DownloadableMedia {
  mediaType: "image" | "document";
  mime: string;
  /** extensão derivada do mime/fileName (sem ponto), ex.: "pdf", "jpg". */
  ext: string;
  /** nome de arquivo para exibir/baixar no inbox. */
  fileName: string;
}

/** Extensão a partir do mime (fallback "bin"). */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  if (map[mime]) return map[mime];
  // mime "application/vnd...." → pega o sufixo depois de "/" e limpa.
  const tail = mime.split("/")[1]?.split(/[;+]/)[0]?.replace(/[^a-zA-Z0-9]/g, "");
  return tail && tail.length <= 5 ? tail.toLowerCase() : "bin";
}

/**
 * Se `inner` for uma mídia que SABEMOS baixar (imagem ou documento), devolve seus
 * metadados; senão null. Mantém o escopo (só imagem/PDF) num só lugar.
 */
export function downloadableMedia(inner: unknown): DownloadableMedia | null {
  if (!inner || typeof inner !== "object") return null;
  const o = inner as Record<string, any>;

  if (o.imageMessage) {
    const mime = o.imageMessage.mimetype || "image/jpeg";
    const ext = extFromMime(mime);
    return { mediaType: "image", mime, ext, fileName: `imagem.${ext}` };
  }
  if (o.documentMessage) {
    const mime = o.documentMessage.mimetype || "application/octet-stream";
    const ext = extFromMime(mime);
    const fileName: string =
      o.documentMessage.fileName?.trim() || `documento.${ext}`;
    return { mediaType: "document", mime, ext, fileName };
  }
  return null;
}
