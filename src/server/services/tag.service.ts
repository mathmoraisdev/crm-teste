import { prisma } from "@/server/db/client";
import type { Tone } from "@/components/ui/Badge";

/** Cores válidas para uma tag = chaves de `Tone` (Badge). */
export const TAG_COLORS: Tone[] = [
  "slate",
  "blue",
  "amber",
  "green",
  "red",
  "violet",
  "emerald",
];

function assertColor(color: string): Tone {
  if (!(TAG_COLORS as string[]).includes(color)) {
    throw new Error("Cor inválida.");
  }
  return color as Tone;
}

export interface TagListItem {
  id: string;
  name: string;
  color: string;
  leadCount: number;
}

/** Catálogo de tags da conta, com a contagem de leads atribuídos. */
export async function listTags(userId: string): Promise<TagListItem[]> {
  const tags = await prisma.tag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: { _count: { select: { leads: true } } },
  });
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    leadCount: t._count.leads,
  }));
}

/** Cria uma tag. Nome único por conta (P2002 → mensagem amigável). */
export async function createTag(userId: string, name: string, color: string) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Nome da tag obrigatório.");
  const tone = assertColor(color);
  try {
    return await prisma.tag.create({
      data: { userId, name: cleanName, color: tone },
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      throw new Error("Já existe uma tag com esse nome.");
    }
    throw e;
  }
}

/** Edita nome/cor de uma tag da conta. */
export async function updateTag(
  userId: string,
  id: string,
  data: { name?: string; color?: string },
) {
  const owned = await prisma.tag.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Tag não encontrada.");
  const patch: { name?: string; color?: string } = {};
  if (data.name !== undefined) {
    const cleanName = data.name.trim();
    if (!cleanName) throw new Error("Nome da tag obrigatório.");
    patch.name = cleanName;
  }
  if (data.color !== undefined) patch.color = assertColor(data.color);
  try {
    return await prisma.tag.update({ where: { id }, data: patch });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      throw new Error("Já existe uma tag com esse nome.");
    }
    throw e;
  }
}

/** Apaga uma tag da conta (desfaz as atribuições via N:N). */
export async function deleteTag(userId: string, id: string): Promise<void> {
  const owned = await prisma.tag.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Tag não encontrada.");
  await prisma.tag.delete({ where: { id } });
}

/**
 * Define o conjunto de tags de um lead (substitui o anterior). Valida posse do
 * lead e de todas as tags antes de gravar.
 */
export async function setLeadTags(
  userId: string,
  leadId: string,
  tagIds: string[],
): Promise<void> {
  const ids = [...new Set(tagIds)];
  // Lead e tags são checagens independentes → paralelizar.
  const [lead, owned] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, userId }, select: { id: true } }),
    ids.length > 0
      ? prisma.tag.findMany({ where: { id: { in: ids }, userId }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ]);
  if (!lead) throw new Error("Lead não encontrado.");
  if (ids.length > 0 && owned.length !== ids.length) {
    throw new Error("Uma ou mais tags não pertencem à sua conta.");
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: { tags: { set: ids.map((id) => ({ id })) } },
  });
}
