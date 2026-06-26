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
