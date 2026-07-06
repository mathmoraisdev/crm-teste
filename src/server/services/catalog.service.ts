import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { CatalogItemKind } from "@prisma/client";
import { getTemplate, catalogSeedItems } from "@/lib/business-templates";

export interface CatalogItemDTO {
  id: string;
  kind: CatalogItemKind;
  name: string;
  priceCents: number;
  active: boolean;
  trackStock: boolean;
  sku: string | null;
  barcode: string | null;
  stockQty: number;
  minStock: number;
  costCents: number | null;
  printSector: string | null;
  durationMinutes: number | null;
}

const upsertSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório."),
  priceCents: z.number().int().min(0, "Preço não pode ser negativo."),
  kind: z.enum(["SERVICO", "PRODUTO"]).default("SERVICO"),
});

// Duração (min) — opcional, só faz sentido para SERVICO. Vazio → null.
const durationSchema = z.object({
  durationMinutes: z.number().int().min(0).nullish(),
});

const stockConfigSchema = z.object({
  trackStock: z.boolean().optional(),
  sku: z.string().trim().max(60).nullish(),
  barcode: z.string().trim().max(64).nullish(),
  minStock: z.number().int().min(0).optional(),
  costCents: z.number().int().min(0).nullish(),
});

// P2002 (unique) no barcode → mensagem amigável (o resto propaga).
function rethrowCatalog(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new Error("Já existe um item com este código de barras.");
  }
  throw e;
}

function toDTO(o: {
  id: string; kind: CatalogItemKind; name: string; priceCents: number; active: boolean;
  trackStock: boolean; sku: string | null; barcode: string | null; stockQty: number; minStock: number; costCents: number | null;
  printSector: string | null; durationMinutes: number | null;
}): CatalogItemDTO {
  return {
    id: o.id, kind: o.kind, name: o.name, priceCents: o.priceCents, active: o.active,
    trackStock: o.trackStock, sku: o.sku, barcode: o.barcode, stockQty: o.stockQty, minStock: o.minStock, costCents: o.costCents,
    printSector: o.printSector, durationMinutes: o.durationMinutes,
  };
}

export async function createCatalogItem(
  accountId: string,
  data: {
    name: string; priceCents: number; kind?: CatalogItemKind;
    trackStock?: boolean; sku?: string | null; barcode?: string | null; minStock?: number; costCents?: number | null;
    printSector?: string | null; durationMinutes?: number | null;
  },
): Promise<CatalogItemDTO> {
  const parsed = upsertSchema.parse(data);
  const cfg = stockConfigSchema.parse(data);
  const dur = durationSchema.parse(data);
  try {
    const item = await prisma.catalogItem.create({
      data: {
        accountId, name: parsed.name, priceCents: parsed.priceCents, kind: parsed.kind,
        trackStock: cfg.trackStock ?? false,
        sku: cfg.sku?.trim() || null,
        barcode: cfg.barcode?.trim() || null,
        minStock: cfg.minStock ?? 0,
        costCents: cfg.costCents ?? null,
        printSector: data.printSector?.trim().toLowerCase() || null,
        durationMinutes: dur.durationMinutes ?? null,
      },
    });
    return toDTO(item);
  } catch (e) {
    rethrowCatalog(e);
  }
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
  data: {
    name?: string; priceCents?: number; kind?: CatalogItemKind; active?: boolean;
    trackStock?: boolean; sku?: string | null; barcode?: string | null; minStock?: number; costCents?: number | null;
    printSector?: string | null; durationMinutes?: number | null;
  },
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
  if (data.trackStock !== undefined) patch.trackStock = data.trackStock;
  if (data.sku !== undefined) patch.sku = data.sku?.trim() || null;
  if (data.barcode !== undefined) patch.barcode = data.barcode?.trim() || null;
  if (data.minStock !== undefined) {
    if (!Number.isInteger(data.minStock) || data.minStock < 0) throw new Error("Mínimo inválido.");
    patch.minStock = data.minStock;
  }
  if (data.costCents !== undefined) patch.costCents = data.costCents === null ? null : data.costCents;
  if (data.durationMinutes !== undefined) {
    if (data.durationMinutes === null) patch.durationMinutes = null;
    else {
      if (!Number.isInteger(data.durationMinutes) || data.durationMinutes < 0) throw new Error("Duração inválida.");
      patch.durationMinutes = data.durationMinutes;
    }
  }
  if (data.printSector !== undefined) patch.printSector = data.printSector?.trim().toLowerCase() || null;
  try {
    const item = await prisma.catalogItem.update({ where: { id }, data: patch });
    return toDTO(item);
  } catch (e) {
    rethrowCatalog(e);
  }
}

/** Resolve o item da conta por código de barras (bipar no caixa). null = não achou.
 * Sem filtro de `active`: o caixa pode bipar um item inativo; o front decide. */
export async function findByBarcode(accountId: string, barcode: string): Promise<CatalogItemDTO | null> {
  const code = barcode.trim();
  if (!code) return null;
  const item = await prisma.catalogItem.findFirst({ where: { accountId, barcode: code } });
  return item ? toDTO(item) : null;
}

export async function deleteCatalogItem(accountId: string, id: string): Promise<void> {
  const owned = await prisma.catalogItem.findFirst({ where: { id, accountId }, select: { id: true } });
  if (!owned) throw new Error("Item não encontrado.");
  await prisma.catalogItem.delete({ where: { id } });
}

/**
 * Semeia o catálogo com os itens sugeridos de um modelo de negócio (ramo).
 * Preço entra ZERADO (o dono precifica depois). Não-destrutivo: só roda quando
 * o catálogo está vazio, para nunca sobrescrever o que já foi cadastrado.
 */
export async function seedCatalogFromTemplate(accountId: string, templateId: string): Promise<CatalogItemDTO[]> {
  const tpl = getTemplate(templateId);
  if (!tpl) throw new Error("Modelo não encontrado.");
  const seeds = catalogSeedItems(tpl);
  if (!seeds.length) throw new Error("Este modelo não tem itens sugeridos.");
  const existing = await prisma.catalogItem.count({ where: { accountId } });
  if (existing > 0) throw new Error("O catálogo já tem itens — o modelo só entra num catálogo vazio.");
  // Mapa nome→preço vindo do preset do ramo (quando houver). Sem preset, o mapa é
  // vazio e todo item nasce com preço 0 (o dono precifica depois).
  const priceByName = new Map((tpl.catalogPreset ?? []).map((p) => [p.name, p.priceCents ?? 0]));
  await prisma.catalogItem.createMany({
    data: seeds.map((s) => ({ accountId, name: s.name, priceCents: priceByName.get(s.name) ?? 0, kind: s.kind })),
  });
  return listCatalogItems(accountId);
}
