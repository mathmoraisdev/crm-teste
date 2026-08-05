import { prisma } from "@/server/db/client";
import {
  uploadCatalogPhoto,
  removeCatalogObjects,
} from "@/server/storage/catalog-storage";

export interface CatalogItemPhotoDTO {
  id: string;
  mediaPath: string;
  mediaMime: string;
  order: number;
}

const IMG_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function toDTO(row: { id: string; mediaPath: string; mediaMime: string; order: number }): CatalogItemPhotoDTO {
  return { id: row.id, mediaPath: row.mediaPath, mediaMime: row.mediaMime, order: row.order };
}

// Garante que o item pertence à conta; lança se não.
async function assertOwnedItem(accountId: string, itemId: string): Promise<void> {
  const owned = await prisma.catalogItem.findFirst({
    where: { id: itemId, accountId },
    select: { id: true },
  });
  if (!owned) throw new Error("Item não encontrado.");
}

export async function listCatalogItemPhotos(accountId: string, itemId: string): Promise<CatalogItemPhotoDTO[]> {
  await assertOwnedItem(accountId, itemId);
  const rows = await prisma.catalogItemPhoto.findMany({
    where: { catalogItemId: itemId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

export async function addCatalogItemPhoto(
  accountId: string,
  itemId: string,
  data: { buffer: Buffer; mime: string },
): Promise<CatalogItemPhotoDTO> {
  await assertOwnedItem(accountId, itemId);
  const ext = IMG_EXT[data.mime.toLowerCase()];
  if (!ext) throw new Error("Envie uma imagem (JPEG, PNG, WebP ou GIF).");

  const mediaPath = await uploadCatalogPhoto(data.buffer, {
    accountId, // assets da conta ficam em <accountId>/<uuid>.<ext> (bucket público)
    mime: data.mime,
    ext,
  });
  if (!mediaPath) throw new Error("Storage de mídia não configurado ou upload falhou.");

  const count = await prisma.catalogItemPhoto.count({ where: { catalogItemId: itemId } });
  const row = await prisma.catalogItemPhoto.create({
    data: { catalogItemId: itemId, mediaPath, mediaMime: data.mime, order: count },
  });
  return toDTO(row);
}

export async function deleteCatalogItemPhoto(accountId: string, itemId: string, photoId: string): Promise<void> {
  await assertOwnedItem(accountId, itemId);
  const photo = await prisma.catalogItemPhoto.findFirst({
    where: { id: photoId, catalogItemId: itemId },
    select: { id: true, mediaPath: true },
  });
  if (!photo) throw new Error("Foto não encontrada.");
  await removeCatalogObjects([photo.mediaPath]); // best-effort
  await prisma.catalogItemPhoto.delete({ where: { id: photo.id } });
}

// Reordena por índice do array (0..n-1); ignora ids que não pertencem ao item.
export async function reorderCatalogItemPhotos(accountId: string, itemId: string, orderedIds: string[]): Promise<void> {
  await assertOwnedItem(accountId, itemId);
  const owned = await prisma.catalogItemPhoto.findMany({
    where: { catalogItemId: itemId },
    select: { id: true },
  });
  const valid = new Set(owned.map((p) => p.id));
  await prisma.$transaction(
    orderedIds
      .filter((id) => valid.has(id))
      .map((id, idx) => prisma.catalogItemPhoto.update({ where: { id }, data: { order: idx } })),
  );
}
