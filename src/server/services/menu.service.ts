import { prisma } from "@/server/db/client";
import { createMediaSignedUrl } from "@/server/storage/media-storage";

export interface MenuItemDTO {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  available: boolean;
  photoUrl: string | null;
  variantGroup: string | null;
}

export interface MenuCategoryDTO {
  name: string;
  items: MenuItemDTO[];
}

export interface PublicMenuDTO {
  categories: MenuCategoryDTO[];
}

const UNCATEGORIZED = "Outros";

/**
 * Cardápio público: itens ativos e visíveis agrupados por `menuCategory`.
 * Itens esgotados (trackStock com stockQty 0) aparecem marcados `available=false`.
 * A foto de capa = `CatalogItemPhoto` de menor `order`, assinada sob demanda.
 */
export async function getPublicMenu(accountId: string): Promise<PublicMenuDTO> {
  const rows = await prisma.catalogItem.findMany({
    where: { accountId, active: true, menuVisible: true },
    orderBy: [{ menuCategory: "asc" }, { name: "asc" }],
    include: { photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], take: 1 } },
  });

  // Assina as capas em paralelo (1 round-trip Supabase por item com foto).
  const withPhotos = await Promise.all(
    rows.map(async (r) => {
      const cover = r.photos[0];
      const photoUrl = cover ? await createMediaSignedUrl(cover.mediaPath) : null;
      const item: MenuItemDTO = {
        id: r.id,
        name: r.name,
        description: r.menuDescription,
        priceCents: r.priceCents,
        available: !r.trackStock || r.stockQty > 0,
        photoUrl,
        variantGroup: r.variantGroup ?? null,
      };
      return { row: r, item };
    }),
  );

  const byCat = new Map<string, MenuItemDTO[]>();
  for (const { row, item } of withPhotos) {
    const cat = row.menuCategory?.trim() || UNCATEGORIZED;
    const list = byCat.get(cat);
    if (list) list.push(item);
    else byCat.set(cat, [item]);
  }

  const categories = [...byCat.entries()].map(([name, items]) => ({ name, items }));
  // "Outros" sempre por último; demais em ordem alfabética.
  categories.sort((a, b) => {
    if (a.name === UNCATEGORIZED) return 1;
    if (b.name === UNCATEGORIZED) return -1;
    return a.name.localeCompare(b.name);
  });
  return { categories };
}
