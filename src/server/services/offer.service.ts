import { z } from "zod";
import { prisma } from "@/server/db/client";
import { assertFeature } from "@/server/services/entitlements";
import { getTemplate } from "@/lib/business-templates";

export interface OfferItem {
  id: string;
  whatsAppNumberId: string;
  name: string;
  description: string | null;
  priceCents: number;
  active: boolean;
}

function toItem(o: {
  id: string;
  whatsAppNumberId: string;
  name: string;
  description: string | null;
  priceCents: number;
  active: boolean;
}): OfferItem {
  return {
    id: o.id,
    whatsAppNumberId: o.whatsAppNumberId,
    name: o.name,
    description: o.description,
    priceCents: o.priceCents,
    active: o.active,
  };
}

// Preço em centavos: mínimo R$1,00. Nome obrigatório. Descrição opcional.
const upsertSchema = z.object({
  name: z.string().trim().min(1, "Nome da oferta obrigatório."),
  description: z.string().trim().nullish(),
  priceCents: z.number().int().min(100, "Preço mínimo é R$1,00."),
});

/** Confere que o número pertence ao tenant (isolamento). */
async function assertOwnsNumber(userId: string, whatsAppNumberId: string): Promise<void> {
  const n = await prisma.whatsAppNumber.findFirst({
    where: { id: whatsAppNumberId, userId },
    select: { id: true },
  });
  if (!n) throw new Error("Número não encontrado.");
}

export async function createOffer(
  userId: string,
  data: { whatsAppNumberId: string; name: string; description?: string | null; priceCents: number },
): Promise<OfferItem> {
  await assertFeature(userId, "sales");
  await assertOwnsNumber(userId, data.whatsAppNumberId);
  const parsed = upsertSchema.parse(data);
  const offer = await prisma.offer.create({
    data: {
      userId,
      whatsAppNumberId: data.whatsAppNumberId,
      name: parsed.name,
      description: parsed.description ?? null,
      priceCents: parsed.priceCents,
    },
  });
  return toItem(offer);
}

/** Ofertas de um número do dono (todas, ativas e inativas), p/ a UI. */
export async function listOffers(userId: string, whatsAppNumberId: string): Promise<OfferItem[]> {
  const offers = await prisma.offer.findMany({
    where: { userId, whatsAppNumberId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  return offers.map(toItem);
}

/** Ofertas ATIVAS de um número (usado no runtime da IA). */
export async function listActiveOffers(whatsAppNumberId: string): Promise<OfferItem[]> {
  const offers = await prisma.offer.findMany({
    where: { whatsAppNumberId, active: true },
    orderBy: { createdAt: "asc" },
  });
  return offers.map(toItem);
}

export async function updateOffer(
  userId: string,
  id: string,
  data: { name?: string; description?: string | null; priceCents?: number; active?: boolean },
): Promise<OfferItem> {
  await assertFeature(userId, "sales");
  const owned = await prisma.offer.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Oferta não encontrada.");

  const patch: { name?: string; description?: string | null; priceCents?: number; active?: boolean } = {};
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("Nome da oferta obrigatório.");
    patch.name = name;
  }
  if (data.description !== undefined) {
    const d = data.description?.trim();
    patch.description = d ? d : null;
  }
  if (data.priceCents !== undefined) {
    if (!Number.isInteger(data.priceCents) || data.priceCents < 100) {
      throw new Error("Preço mínimo é R$1,00.");
    }
    patch.priceCents = data.priceCents;
  }
  if (data.active !== undefined) patch.active = data.active;

  const offer = await prisma.offer.update({ where: { id }, data: patch });
  return toItem(offer);
}

/**
 * Semeia as ofertas sugeridas pelo ramo (`suggestedOffers`) num número. Idempotente
 * por PRÉ-CARGA dos nomes já existentes (não por capturar P2002). Ofertas nascem
 * INATIVAS e com priceCents 0 (a definir): o dono revisa preço e publica — o runtime
 * da IA só lê ofertas ativas (`listActiveOffers`). Gateado por `sales` + posse do número.
 */
export async function seedOffersFromTemplate(
  userId: string,
  whatsAppNumberId: string,
  templateId: string,
): Promise<{ created: number; skipped: number }> {
  const offers = getTemplate(templateId)?.suggestedOffers;
  if (!offers || offers.length === 0) return { created: 0, skipped: 0 };
  await assertFeature(userId, "sales");
  await assertOwnsNumber(userId, whatsAppNumberId);

  const existing = await prisma.offer.findMany({
    where: { userId, whatsAppNumberId },
    select: { name: true },
  });
  const seen = new Set(existing.map((o) => o.name.trim().toLowerCase()));

  let created = 0;
  let skipped = 0;
  for (const o of offers) {
    const key = o.name.trim().toLowerCase();
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    // Descrição carrega o priceHint (texto) já que o preço nasce a definir.
    const description = [o.description, o.priceHint && `(${o.priceHint})`].filter(Boolean).join(" ") || null;
    await prisma.offer.create({
      data: { userId, whatsAppNumberId, name: o.name.trim(), description, priceCents: 0, active: false },
    });
    seen.add(key);
    created++;
  }
  return { created, skipped };
}

export async function deleteOffer(userId: string, id: string): Promise<void> {
  const owned = await prisma.offer.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Oferta não encontrada.");
  await prisma.offer.delete({ where: { id } });
}
