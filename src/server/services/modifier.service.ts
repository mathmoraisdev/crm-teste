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
