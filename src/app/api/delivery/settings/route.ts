import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";
import { getTenantContext } from "@/lib/tenant";
import { ensureSlug } from "@/server/services/booking-settings.service";
import { getDeliverySettings, updateDeliverySettings } from "@/server/services/delivery-settings.service";

export const dynamic = "force-dynamic";

/** Monta o link público absoluto do cardápio p/ um slug (null se não há slug). */
function menuLink(slug: string | null): string | null {
  return slug ? `${env.APP_URL}/cardapio/${slug}` : null;
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const ownerId = ctx.tenantUserId;
  const [settings, u] = await Promise.all([
    getDeliverySettings(ownerId),
    prisma.user.findUnique({ where: { id: ownerId }, select: { publicSlug: true, menuEnabled: true } }),
  ]);
  return NextResponse.json({
    ...settings,
    menuEnabled: u?.menuEnabled ?? false,
    publicSlug: u?.publicSlug ?? null,
    publicUrl: menuLink(u?.publicSlug ?? null),
  });
}

const hoursWindow = z.object({ open: z.string(), close: z.string() });
const hoursSchema = z.record(z.string(), z.array(hoursWindow));

const patchSchema = z.object({
  menuEnabled: z.boolean().optional(),
  publicSlug: z.string().optional(),
  deliveryEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  payOnlineEnabled: z.boolean().optional(),
  payOnDeliveryEnabled: z.boolean().optional(),
  minOrderCents: z.number().int().min(0).optional(),
  defaultPrepMinutes: z.number().int().min(0).max(600).optional(),
  hours: hoursSchema.nullable().optional(),
});

export async function PUT(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json(
      { error: "Seu usuário não tem permissão para alterar as configurações da conta." },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }

  const ownerId = ctx.tenantUserId;
  try {
    // Publicar o cardápio sem slug ainda: gera um antes de salvar, senão o link não existe.
    if (parsed.data.menuEnabled === true && parsed.data.publicSlug === undefined) {
      await ensureSlug(ownerId);
    }
    // Toggle do gate do link público mora no User.
    if (parsed.data.menuEnabled !== undefined) {
      await prisma.user.update({ where: { id: ownerId }, data: { menuEnabled: parsed.data.menuEnabled } });
    }
    // Slug é do User também (compartilhado com o agendamento).
    if (parsed.data.publicSlug !== undefined) {
      const slug = parsed.data.publicSlug.trim();
      await prisma.user.update({ where: { id: ownerId }, data: { publicSlug: slug || null } });
    }
    const settings = await updateDeliverySettings(ownerId, parsed.data);
    const u = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { publicSlug: true, menuEnabled: true },
    });
    return NextResponse.json({
      ...settings,
      menuEnabled: u?.menuEnabled ?? false,
      publicSlug: u?.publicSlug ?? null,
      publicUrl: menuLink(u?.publicSlug ?? null),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar configurações de delivery" },
      { status: 400 },
    );
  }
}
