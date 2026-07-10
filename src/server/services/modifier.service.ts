import { prisma } from "@/server/db/client";

export interface ModifierSnapshotEntry {
  groupName: string;
  optionName: string;
  priceDeltaCents: number;
}
export interface ResolvedModifiers {
  deltaCents: number;
  snapshot: ModifierSnapshotEntry[] | null; // null quando não há seleção
}

/**
 * Resolve as opções escolhidas (`optionIds`) de um item CONTRA o banco: valida
 * min/max por grupo, pertencimento e atividade, e retorna o delta total + o
 * snapshot ordenado. FONTE DE VERDADE do preço dos adicionais — nunca confie no
 * client. Lança "CODE:mensagem" p/ o handler online mapear p/ 409.
 */
export async function resolveModifierSelection(
  accountId: string,
  catalogItemId: string,
  optionIds: string[],
): Promise<ResolvedModifiers> {
  const groups = await prisma.modifierGroup.findMany({
    where: { catalogItemId, accountId },
    orderBy: { sortOrder: "asc" },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  });

  const chosen = new Set(optionIds);
  // Toda opção escolhida tem que ser de algum grupo do item.
  const validOptionIds = new Set(groups.flatMap((g) => g.options.map((o) => o.id)));
  for (const id of chosen) {
    if (!validOptionIds.has(id)) throw new Error("MODIFIER:Adicional inválido para este item.");
  }

  let deltaCents = 0;
  const snapshot: ModifierSnapshotEntry[] = [];
  for (const g of groups) {
    const picked = g.options.filter((o) => chosen.has(o.id));
    if (picked.some((o) => !o.active)) {
      throw new Error(`MODIFIER:Um adicional de "${g.name}" está indisponível.`);
    }
    if (picked.length < g.minSelect) {
      throw new Error(`MODIFIER:Escolha ${g.minSelect === g.maxSelect ? "" : "ao menos "}${g.minSelect} em "${g.name}".`);
    }
    if (picked.length > g.maxSelect) {
      throw new Error(`MODIFIER:Máximo de ${g.maxSelect} em "${g.name}".`);
    }
    for (const o of picked) {
      deltaCents += o.priceDeltaCents;
      snapshot.push({ groupName: g.name, optionName: o.name, priceDeltaCents: o.priceDeltaCents });
    }
  }

  return { deltaCents, snapshot: snapshot.length ? snapshot : null };
}

export interface ModifierGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { name: string; priceDeltaCents: number; active?: boolean }[];
}

/** Grupos+opções ATIVAS de vários itens, agrupados por catalogItemId. Para o
 * contexto da IA (uma query só, escopada por conta). Grupo sem opção ativa é
 * omitido. Map vazio quando não há itens (evita a query). */
export async function listModifiersForItems(
  accountId: string,
  catalogItemIds: string[],
): Promise<Map<string, { name: string; options: { name: string; priceDeltaCents: number }[] }[]>> {
  const map = new Map<string, { name: string; options: { name: string; priceDeltaCents: number }[] }[]>();
  if (!catalogItemIds.length) return map;
  const groups = await prisma.modifierGroup.findMany({
    where: { accountId, catalogItemId: { in: catalogItemIds } },
    orderBy: { sortOrder: "asc" },
    include: { options: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  for (const g of groups) {
    if (!g.options.length) continue;
    const arr = map.get(g.catalogItemId) ?? [];
    arr.push({ name: g.name, options: g.options.map((o) => ({ name: o.name, priceDeltaCents: o.priceDeltaCents })) });
    map.set(g.catalogItemId, arr);
  }
  return map;
}

/** Lê os grupos+opções de um item (para a UI de edição e o cardápio). */
export async function listItemModifiers(accountId: string, catalogItemId: string) {
  return prisma.modifierGroup.findMany({
    where: { catalogItemId, accountId },
    orderBy: { sortOrder: "asc" },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  });
}

/** Substitui TODO o conjunto de grupos/opções do item (replace-all, transacional).
 * Valida escopo (item é da conta) e sanidade (min<=max, nomes, deltas inteiros). */
export async function saveItemModifiers(
  accountId: string,
  catalogItemId: string,
  groups: ModifierGroupInput[],
): Promise<void> {
  const item = await prisma.catalogItem.findFirst({ where: { id: catalogItemId, accountId }, select: { id: true } });
  if (!item) throw new Error("Item do catálogo não encontrado.");

  for (const g of groups) {
    if (!g.name?.trim()) throw new Error("Grupo sem nome.");
    if (!Number.isInteger(g.minSelect) || !Number.isInteger(g.maxSelect) || g.minSelect < 0 || g.maxSelect < 1 || g.minSelect > g.maxSelect) {
      throw new Error(`Limites inválidos em "${g.name}".`);
    }
    if (!g.options.length) throw new Error(`"${g.name}" precisa de ao menos uma opção.`);
    for (const o of g.options) {
      if (!o.name?.trim()) throw new Error(`Opção sem nome em "${g.name}".`);
      if (!Number.isInteger(o.priceDeltaCents) || o.priceDeltaCents < 0) throw new Error(`Preço inválido em "${o.name}".`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.modifierGroup.deleteMany({ where: { catalogItemId, accountId } });
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      await tx.modifierGroup.create({
        data: {
          accountId, catalogItemId, name: g.name.trim(),
          minSelect: g.minSelect, maxSelect: g.maxSelect, sortOrder: gi,
          options: {
            create: g.options.map((o, oi) => ({
              name: o.name.trim(), priceDeltaCents: o.priceDeltaCents,
              active: o.active ?? true, sortOrder: oi,
            })),
          },
        },
      });
    }
  });
}
