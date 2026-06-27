import { prisma } from "@/server/db/client";
import { Prisma } from "@prisma/client";
import type { CustomFieldType } from "@prisma/client";

const FIELD_TYPES: CustomFieldType[] = ["TEXT", "NUMBER", "DATE", "SELECT", "BOOLEAN"];

/** Gera um slug estável a partir do label (a-z0-9_, minúsculo). */
export function slugifyKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export interface CustomFieldDefItem {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[] | null;
  order: number;
}

function toItem(d: {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: Prisma.JsonValue;
  order: number;
}): CustomFieldDefItem {
  return {
    id: d.id,
    key: d.key,
    label: d.label,
    type: d.type,
    options: Array.isArray(d.options) ? (d.options as string[]) : null,
    order: d.order,
  };
}

/** Defs da conta, ordenadas por `order` e depois `label`. */
export async function listDefs(userId: string): Promise<CustomFieldDefItem[]> {
  const defs = await prisma.customFieldDef.findMany({
    where: { userId },
    orderBy: [{ order: "asc" }, { label: "asc" }],
  });
  return defs.map(toItem);
}

function normalizeOptions(type: CustomFieldType, options?: string[] | null): string[] | null {
  if (type !== "SELECT") return null;
  const clean = (options ?? []).map((o) => o.trim()).filter(Boolean);
  if (clean.length === 0) throw new Error("Campo SELECT precisa de ao menos uma opção.");
  return clean;
}

export async function createDef(
  userId: string,
  data: { label: string; type: CustomFieldType; options?: string[] | null; order?: number },
): Promise<CustomFieldDefItem> {
  const label = data.label.trim();
  if (!label) throw new Error("Rótulo do campo obrigatório.");
  if (!FIELD_TYPES.includes(data.type)) throw new Error("Tipo de campo inválido.");
  const key = slugifyKey(label);
  if (!key) throw new Error("Rótulo inválido para gerar a chave do campo.");
  const options = normalizeOptions(data.type, data.options);
  try {
    const def = await prisma.customFieldDef.create({
      data: {
        userId,
        key,
        label,
        type: data.type,
        options: options ?? undefined,
        order: data.order ?? 0,
      },
    });
    return toItem(def);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      throw new Error("Já existe um campo com esse rótulo.");
    }
    throw e;
  }
}

export async function updateDef(
  userId: string,
  id: string,
  data: { label?: string; type?: CustomFieldType; options?: string[] | null; order?: number },
): Promise<CustomFieldDefItem> {
  const owned = await prisma.customFieldDef.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Campo não encontrado.");

  const patch: Prisma.CustomFieldDefUpdateInput = {};
  const nextType = data.type ?? owned.type;
  if (data.type !== undefined) {
    if (!FIELD_TYPES.includes(data.type)) throw new Error("Tipo de campo inválido.");
    patch.type = data.type;
  }
  if (data.label !== undefined) {
    const label = data.label.trim();
    if (!label) throw new Error("Rótulo do campo obrigatório.");
    patch.label = label;
  }
  if (data.order !== undefined) patch.order = data.order;
  // Recalcula opções se o tipo virou (ou continua) SELECT, ou se vieram opções.
  if (data.type !== undefined || data.options !== undefined) {
    const opts = normalizeOptions(nextType, data.options ?? (Array.isArray(owned.options) ? (owned.options as string[]) : null));
    patch.options = opts ?? Prisma.JsonNull;
  }

  const def = await prisma.customFieldDef.update({ where: { id }, data: patch });
  return toItem(def);
}

export async function deleteDef(userId: string, id: string): Promise<void> {
  const owned = await prisma.customFieldDef.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Campo não encontrado.");
  await prisma.customFieldDef.delete({ where: { id } });
}

/**
 * Valida e mescla (raso) um patch de `customFields` contra as defs da conta.
 * Cada `key` precisa existir; o valor precisa casar com o `type`. Valor `null`
 * limpa a chave. Retorna o objeto Json completo já mesclado para gravar.
 */
export async function mergeCustomFields(
  userId: string,
  current: Prisma.JsonValue | null | undefined,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const defs = await prisma.customFieldDef.findMany({ where: { userId } });
  const byKey = new Map(defs.map((d) => [d.key, d]));

  const base: Record<string, unknown> =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};

  for (const [key, raw] of Object.entries(patch)) {
    const def = byKey.get(key);
    if (!def) throw new Error(`Campo customizado desconhecido: ${key}`);
    if (raw === null || raw === undefined || raw === "") {
      delete base[key];
      continue;
    }
    base[key] = coerceValue(def.type, def.options, raw, def.label);
  }
  return base;
}

function coerceValue(
  type: CustomFieldType,
  options: Prisma.JsonValue,
  raw: unknown,
  label: string,
): unknown {
  switch (type) {
    case "TEXT":
      return String(raw);
    case "NUMBER": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isNaN(n)) throw new Error(`Campo "${label}" precisa ser um número.`);
      return n;
    }
    case "BOOLEAN":
      return raw === true || raw === "true" || raw === 1 || raw === "1";
    case "DATE": {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) throw new Error(`Campo "${label}" precisa ser uma data válida.`);
      return d.toISOString();
    }
    case "SELECT": {
      const allowed = Array.isArray(options) ? (options as string[]) : [];
      const v = String(raw);
      if (!allowed.includes(v)) throw new Error(`Valor inválido para "${label}".`);
      return v;
    }
    default:
      return String(raw);
  }
}
