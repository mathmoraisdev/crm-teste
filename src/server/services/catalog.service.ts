import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { CatalogItemKind } from "@prisma/client";

export interface CatalogItemDTO {
  id: string;
  kind: CatalogItemKind;
  name: string;
  priceCents: number;
  active: boolean;
}

const upsertSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório."),
  priceCents: z.number().int().min(0, "Preço não pode ser negativo."),
  kind: z.enum(["SERVICO", "PRODUTO"]).default("SERVICO"),
});

function toDTO(o: { id: string; kind: CatalogItemKind; name: string; priceCents: number; active: boolean }): CatalogItemDTO {
  return { id: o.id, kind: o.kind, name: o.name, priceCents: o.priceCents, active: o.active };
}

export async function createCatalogItem(
  accountId: string,
  data: { name: string; priceCents: number; kind?: CatalogItemKind },
): Promise<CatalogItemDTO> {
  const parsed = upsertSchema.parse(data);
  const item = await prisma.catalogItem.create({
    data: { accountId, name: parsed.name, priceCents: parsed.priceCents, kind: parsed.kind },
  });
  return toDTO(item);
}

export async function listCatalogItems(accountId: string, opts?: { activeOnly?: boolean }): Promise<CatalogItemDTO[]> {
  const items = await prisma.catalogItem.findMany({
    where: { accountId, ...(opts?.activeOnly ? { active: true } : {}) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return items.map(toDTO);
}

export async function updateCatalogItem(
  accountId: string,
  id: string,
  data: { name?: string; priceCents?: number; kind?: CatalogItemKind; active?: boolean },
): Promise<CatalogItemDTO> {
  const owned = await prisma.catalogItem.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Item não encontrado.");
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("Nome obrigatório.");
    patch.name = name;
  }
  if (data.priceCents !== undefined) {
    if (!Number.isInteger(data.priceCents) || data.priceCents < 0) throw new Error("Preço inválido.");
    patch.priceCents = data.priceCents;
  }
  if (data.kind !== undefined) patch.kind = data.kind;
  if (data.active !== undefined) patch.active = data.active;
  const item = await prisma.catalogItem.update({ where: { id }, data: patch });
  return toDTO(item);
}

export async function deleteCatalogItem(accountId: string, id: string): Promise<void> {
  const owned = await prisma.catalogItem.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Item não encontrado.");
  await prisma.catalogItem.delete({ where: { id } });
}
