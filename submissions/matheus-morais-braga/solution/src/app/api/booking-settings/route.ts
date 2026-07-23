import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { getTenantContext } from "@/lib/tenant";
import {
  getBookingSettings,
  setBookingSettings,
  ensureSlug,
} from "@/server/services/booking-settings.service";

export const dynamic = "force-dynamic";

/** Monta o link público absoluto p/ um slug (null se não há slug). */
function publicLink(slug: string | null): string | null {
  return slug ? `${env.APP_URL}/agendar/${slug}` : null;
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const settings = await getBookingSettings(ctx.tenantUserId);
  return NextResponse.json({ ...settings, publicUrl: publicLink(settings.publicSlug) });
}

const patchSchema = z.object({
  bookingEnabled: z.boolean().optional(),
  bookingLeadMinutes: z.number().int().min(0).optional(),
  bookingHorizonDays: z.number().int().min(1).max(180).optional(),
  bookingSlotStep: z.number().int().min(5).max(120).optional(),
  publicSlug: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
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
  try {
    // Ligar o booking sem slug ainda: gera um antes de salvar, senão o link não existe.
    if (parsed.data.bookingEnabled === true && parsed.data.publicSlug === undefined) {
      await ensureSlug(ctx.tenantUserId);
    }
    const settings = await setBookingSettings(ctx.tenantUserId, parsed.data);
    return NextResponse.json({ ...settings, publicUrl: publicLink(settings.publicSlug) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar configurações de agendamento" },
      { status: 400 },
    );
  }
}
