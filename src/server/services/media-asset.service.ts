import crypto from "node:crypto";
import { prisma } from "@/server/db/client";
import { uploadInboundMedia, removeMediaObjects } from "@/server/storage/media-storage";

export interface MediaAssetDTO {
  id: string;
  label: string;
  mediaPath: string;
  mediaType: "image" | "document";
  mediaMime: string;
  fileName: string | null;
  createdAt: Date;
}

function toDTO(a: {
  id: string; label: string; mediaPath: string; mediaType: string;
  mediaMime: string; fileName: string | null; createdAt: Date;
}): MediaAssetDTO {
  return {
    id: a.id, label: a.label, mediaPath: a.mediaPath,
    mediaType: a.mediaType === "image" ? "image" : "document",
    mediaMime: a.mediaMime, fileName: a.fileName, createdAt: a.createdAt,
  };
}

/** image/* → "image"; o resto (PDF, docs) → "document" (áudio não entra: mídia de saída da IA é visual). */
function mediaTypeFromMime(mime: string): "image" | "document" {
  return mime.startsWith("image/") ? "image" : "document";
}

/** Extensão a partir do mime (fallback bin). Só p/ compor o path no Storage. */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/gif": "gif", "application/pdf": "pdf",
  };
  return map[mime.toLowerCase()] ?? "bin";
}

/** Assets da conta, mais recentes primeiro. Escopado por `accountId`. */
export async function listMediaAssets(accountId: string): Promise<MediaAssetDTO[]> {
  const rows = await prisma.mediaAsset.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDTO);
}

/** Um asset da conta por id (escopado). null se não existe ou é de outra conta. */
export async function getMediaAsset(accountId: string, id: string): Promise<MediaAssetDTO | null> {
  const row = await prisma.mediaAsset.findFirst({ where: { id, accountId } });
  return row ? toDTO(row) : null;
}

/**
 * Sobe um arquivo para a biblioteca da conta: envia o binário ao Storage e grava
 * o metadado. Lança se o Storage não estiver configurado (sem ele não há como a
 * IA reenviar depois). Escopado por `accountId` (o path também).
 */
export async function createMediaAsset(
  accountId: string,
  data: { label: string; buffer: Buffer; mime: string; fileName?: string | null },
): Promise<MediaAssetDTO> {
  const label = data.label.trim();
  if (!label) throw new Error("Informe um rótulo para a mídia.");
  const mediaType = mediaTypeFromMime(data.mime);
  // path escopado por conta (leadId do uploader genérico = accountId): accountId/<key>.<ext>
  const key = crypto.randomUUID();
  const mediaPath = await uploadInboundMedia(data.buffer, {
    leadId: accountId,
    messageKey: key,
    mime: data.mime,
    ext: extFromMime(data.mime),
  });
  if (!mediaPath) throw new Error("Storage de mídia não configurado ou upload falhou.");

  const row = await prisma.mediaAsset.create({
    data: {
      accountId, label, mediaPath, mediaType, mediaMime: data.mime,
      fileName: data.fileName?.trim() || null,
    },
  });
  return toDTO(row);
}

/**
 * Remove um asset da conta: apaga o binário do Storage (best-effort) e a linha.
 * Escopado por `accountId` (não deixa apagar de outra conta).
 */
export async function deleteMediaAsset(accountId: string, id: string): Promise<void> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id, accountId }, select: { mediaPath: true } });
  if (!asset) throw new Error("Mídia não encontrada.");
  await removeMediaObjects([asset.mediaPath]); // best-effort: não bloqueia a exclusão do registro
  await prisma.mediaAsset.delete({ where: { id } });
}
