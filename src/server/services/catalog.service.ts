import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { CatalogItemKind } from "@prisma/client";
import { getTemplate, catalogSeedItems } from "@/lib/business-templates";
import { mergeCustomFields } from "@/server/services/custom-field.service";

export interface CatalogItemDTO {
  id: string;
  kind: CatalogItemKind;
  name: string;
  priceCents: number;
  active: boolean;
  trackStock: boolean;
  sku: string | null;
  barcode: string | null;
  variantGroup: string | null;
  stockQty: number;
  minStock: number;
  costCents: number | null;
  printSector: string | null;
  durationMinutes: number | null;
  customFields: Record<string, unknown> | null;
  // Cardápio online (Onda L): visibilidade, categoria (tópico) e descrição.
  menuVisible: boolean;
  menuCategory: string | null;
  menuDescription: string | null;
  // Adicionais precificados (onda-N): tem grupos? (determina se o PDV abre o
  // seletor ao adicionar). Vem do _count no listCatalogItems — sem N+1 por clique.
  hasModifiers: boolean;
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
  variantGroup: z.string().trim().max(60).nullish(),
  minStock: z.number().int().min(0).optional(),
  costCents: z.number().int().min(0).nullish(),
});

// Cardápio online: mostrar/ocultar, categoria (tópico) e descrição do item.
const menuConfigSchema = z.object({
  menuVisible: z.boolean().optional(),
  menuCategory: z.string().trim().max(60).nullish(),
  menuDescription: z.string().trim().max(280).nullish(),
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
  trackStock: boolean; sku: string | null; barcode: string | null; variantGroup: string | null; stockQty: number; minStock: number; costCents: number | null;
  printSector: string | null; durationMinutes: number | null; customFields: Prisma.JsonValue | null;
  menuVisible: boolean; menuCategory: string | null; menuDescription: string | null;
  _count?: { modifierGroups: number };
}): CatalogItemDTO {
  return {
    id: o.id, kind: o.kind, name: o.name, priceCents: o.priceCents, active: o.active,
    trackStock: o.trackStock, sku: o.sku, barcode: o.barcode, variantGroup: o.variantGroup, stockQty: o.stockQty, minStock: o.minStock, costCents: o.costCents,
    printSector: o.printSector, durationMinutes: o.durationMinutes,
    customFields: (o.customFields as Record<string, unknown> | null) ?? null,
    menuVisible: o.menuVisible, menuCategory: o.menuCategory, menuDescription: o.menuDescription,
    hasModifiers: (o._count?.modifierGroups ?? 0) > 0,
  };
}

export async function createCatalogItem(
  accountId: string,
  data: {
    name: string; priceCents: number; kind?: CatalogItemKind;
    trackStock?: boolean; sku?: string | null; barcode?: string | null; variantGroup?: string | null; minStock?: number; costCents?: number | null;
    printSector?: string | null; durationMinutes?: number | null;
    menuVisible?: boolean; menuCategory?: string | null; menuDescription?: string | null;
  },
): Promise<CatalogItemDTO> {
  const parsed = upsertSchema.parse(data);
  const cfg = stockConfigSchema.parse(data);
  const dur = durationSchema.parse(data);
  const menu = menuConfigSchema.parse(data);
  try {
    const item = await prisma.catalogItem.create({
      data: {
        accountId, name: parsed.name, priceCents: parsed.priceCents, kind: parsed.kind,
        trackStock: cfg.trackStock ?? false,
        sku: cfg.sku?.trim() || null,
        barcode: cfg.barcode?.trim() || null,
        variantGroup: cfg.variantGroup?.trim() || null,
        minStock: cfg.minStock ?? 0,
        costCents: cfg.costCents ?? null,
        printSector: data.printSector?.trim().toLowerCase() || null,
        durationMinutes: dur.durationMinutes ?? null,
        ...(menu.menuVisible !== undefined ? { menuVisible: menu.menuVisible } : {}),
        menuCategory: menu.menuCategory?.trim() || null,
        menuDescription: menu.menuDescription?.trim() || null,
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
    include: { _count: { select: { modifierGroups: true } } },
  });
  return items.map(toDTO);
}

export async function updateCatalogItem(
  accountId: string,
  id: string,
  data: {
    name?: string; priceCents?: number; kind?: CatalogItemKind; active?: boolean;
    trackStock?: boolean; sku?: string | null; barcode?: string | null; variantGroup?: string | null; minStock?: number; costCents?: number | null;
    printSector?: string | null; durationMinutes?: number | null;
    menuVisible?: boolean; menuCategory?: string | null; menuDescription?: string | null;
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
  if (data.variantGroup !== undefined) patch.variantGroup = data.variantGroup?.trim() || null;
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
  if (data.menuVisible !== undefined) patch.menuVisible = data.menuVisible;
  if (data.menuCategory !== undefined) patch.menuCategory = data.menuCategory?.trim() || null;
  if (data.menuDescription !== undefined) patch.menuDescription = data.menuDescription?.trim() || null;
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

// Duplica um item: cria uma cópia com os mesmos dados descritivos (nome + " (cópia)",
// preço, tipo, duração, setor, grupo/grade, config de estoque e ficha técnica). NÃO
// copia o que é identidade/quantidade do item: `sku`/`barcode` ficam nulos (barcode é
// único por conta) e `stockQty` nasce em 0 (o saldo é um livro-razão, entra por movimento).
export async function duplicateCatalogItem(accountId: string, id: string): Promise<CatalogItemDTO> {
  const src = await prisma.catalogItem.findFirst({ where: { id, accountId } });
  if (!src) throw new Error("Item não encontrado.");
  const copy = await prisma.catalogItem.create({
    data: {
      accountId,
      name: `${src.name} (cópia)`,
      kind: src.kind,
      priceCents: src.priceCents,
      durationMinutes: src.durationMinutes,
      printSector: src.printSector,
      trackStock: src.trackStock,
      minStock: src.minStock,
      costCents: src.costCents,
      variantGroup: src.variantGroup,
      ...(src.customFields != null ? { customFields: src.customFields as Prisma.InputJsonValue } : {}),
      // sku/barcode → null (barcode é único); stockQty → 0 (default); active → true (default).
    },
  });
  return toDTO(copy);
}

// Grava a ficha técnica (specs) do item — valores dos CustomFieldDef scope=PRODUCT.
// Valida posse, mescla/coage via mergeCustomFields (chave desconhecida → erro;
// valor vazio → remove a chave). Retorna o DTO atualizado.
export async function setCatalogItemCustomFields(
  accountId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<CatalogItemDTO> {
  const owned = await prisma.catalogItem.findFirst({
    where: { id, accountId },
    select: { id: true, customFields: true },
  });
  if (!owned) throw new Error("Item não encontrado.");
  const merged = await mergeCustomFields(
    accountId,
    owned.customFields ?? null,
    patch,
    "PRODUCT",
  );
  const row = await prisma.catalogItem.update({
    where: { id },
    data: { customFields: merged as Prisma.InputJsonValue },
  });
  return toDTO(row);
}
