/**
 * Montagem do conteúdo de mídia do Baileys — extraída de `pool.ts` para isolá-la
 * de side-effects de import (env/prisma/baileys) e permitir teste unitário puro.
 *
 * `pool.ts` importa e usa em `send()`; o teste cobre os 3 ramos (image/audio/doc)
 * direto, sem subir o socket.
 */

/** Mídia de saída enviada ao chip (buffer + tipo + mime + nome do arquivo). */
export interface SendMedia {
  buffer: Buffer;
  mediaType: "image" | "document" | "audio";
  mime: string;
  fileName?: string;
}

/**
 * Monta o conteúdo de mídia do Baileys. `caption` = texto (legenda); áudio não
 * suporta legenda. Documento precisa de fileName p/ o WhatsApp exibir o nome.
 *
 * Áudio vai como PTT (push-to-talk) → bolinha de nota de voz redonda no WhatsApp
 * do destinatário (em vez de arquivo reproduzível quadrado). Sem `ptt` o Baileys
 * enviaria um arquivo de áudio comum.
 */
export function baileysMediaContent(media: SendMedia, caption?: string) {
  const mimetype = media.mime;
  if (media.mediaType === "image") return { image: media.buffer, mimetype, caption };
  if (media.mediaType === "audio") return { audio: media.buffer, mimetype, ptt: true };
  return {
    document: media.buffer,
    mimetype,
    fileName: media.fileName ?? "arquivo",
    caption,
  };
}
