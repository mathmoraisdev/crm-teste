import { prisma } from "@/server/db/client";
import { getTemplate } from "@/lib/business-templates";
import { createDef, slugifyKey } from "@/server/services/custom-field.service";

/**
 * Semeia os campos personalizados sugeridos pelo ramo (`customFieldsPreset` do
 * BusinessTemplate) na conta. Idempotente por PRÉ-CARGA das keys já existentes
 * (por escopo), não por capturar P2002 — `createDef` converte o P2002 numa Error
 * amigável, que não é sinal confiável de "pular". Retorna quantos criou/pulou.
 */
export async function seedCustomFieldPreset(
  userId: string,
  templateId: string,
): Promise<{ created: number; skipped: number }> {
  const preset = getTemplate(templateId)?.customFieldsPreset;
  if (!preset || preset.length === 0) return { created: 0, skipped: 0 };

  const existing = await prisma.customFieldDef.findMany({
    where: { userId },
    select: { scope: true, key: true },
  });
  const seen = new Set(existing.map((d) => `${d.scope}|${d.key}`));

  let created = 0;
  let skipped = 0;
  for (const item of preset) {
    const key = slugifyKey(item.label);
    const id = `${item.scope}|${key}`;
    if (seen.has(id)) {
      skipped++;
      continue;
    }
    await createDef(userId, {
      label: item.label,
      type: item.type,
      scope: item.scope,
      options: item.options,
    });
    seen.add(id);
    created++;
  }
  return { created, skipped };
}
