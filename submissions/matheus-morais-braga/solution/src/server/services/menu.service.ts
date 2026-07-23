import { prisma } from "@/server/db/client";
import { createMediaSignedUrl } from "@/server/storage/media-storage";

export interface MenuModifierOptionDTO {
  id: string;
  name: string;
  priceDeltaCents: number;
}
export interface MenuModifierGroupDTO {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuModifierOptionDTO[];
}

export interface MenuItemDTO {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  available: boolean;
  photoUrl: string | null;
  variantGroup: string | null;
  // Adicionais precificados (onda-N): grupos com opções ATIVAS p/ o picker montar
  // sem fetch extra (a página é server-rendered). Vazio = item sem adicionais.
  modifierGroups: MenuModifierGroupDTO[];
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
  const [rows, settingsRow] = await Promise.all([
    prisma.catalogItem.findMany({
      where: { accountId, active: true, menuVisible: true },
      orderBy: [{ menuCategory: "asc" }, { name: "asc" }],
      include: {
        photos: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], take: 1 },
        modifierGroups: {
          orderBy: { sortOrder: "asc" },
          include: { options: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
        },
      },
    }),
    prisma.deliverySettings.findUnique({
      where: { accountId },
      select: { categoryOrderJson: true },
    }),
  ]);

  // Ordem manual das categorias (nomes de menuCategory). Índice menor = mais no topo.
  const rawOrder = settingsRow?.categoryOrderJson;
  const orderIndex = new Map(
    (Array.isArray(rawOrder) ? rawOrder.filter((x): x is string => typeof x === "string") : []).map(
      (name, i) => [name, i] as const,
    ),
  );

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
        // grupo sem opção ativa não vai p/ o cardápio (evita grupo obrigatório vazio).
        modifierGroups: r.modifierGroups
          .filter((g) => g.options.length > 0)
          .map((g) => ({
            id: g.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options.map((o) => ({ id: o.id, name: o.name, priceDeltaCents: o.priceDeltaCents })),
          })),
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
  // "Outros" sempre por último. Demais: pela ordem manual (categoryOrder); categoria
  // fora da lista vem depois das ordenadas, em ordem alfabética entre si.
  categories.sort((a, b) => {
    if (a.name === UNCATEGORIZED) return 1;
    if (b.name === UNCATEGORIZED) return -1;
    const ia = orderIndex.get(a.name) ?? Infinity;
    const ib = orderIndex.get(b.name) ?? Infinity;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name);
  });
  return { categories };
}
