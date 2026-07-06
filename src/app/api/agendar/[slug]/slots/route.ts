import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { zonedWallTimeToUtc } from "@/lib/agenda/availability";
import { getAvailableSlots } from "@/server/services/booking-availability.service";

// PÚBLICO (sem auth): o widget de agendamento (link /agendar/<slug>) busca aqui os
// horários livres de um dia. A porta pública é a allowlist do middleware; aqui só
// resolvemos a conta pelo slug (+ bookingEnabled) e delegamos ao serviço.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = env.SCHEDULING_TIMEZONE;
const DAY_MS = 24 * 60 * 60 * 1000;

const querySchema = z.object({
  catalogItemId: z.string().min(1, "Serviço obrigatório."),
  professionalId: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."), // dia local YYYY-MM-DD
});

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // rateLimit degrada p/ "sempre ok" sem Redis — importado dinâmico p/ manter a
  // rota leve; a proteção real vale em produção (Redis provisionado).
  const { rateLimit } = await import("@/lib/ratelimit");
  const rl = await rateLimit(`booking:slots:${clientIp(req)}:${slug}`, 60, 60);
  if (!rl.ok) {
    return NextResponse.json({ error: "Muitas tentativas. Tente em instantes." }, { status: 429 });
  }

  // Conta pelo slug + booking LIGADO. 404 idêntico p/ "não existe" e "existe mas
  // desligado" — não vaza quais contas usam o produto.
  const account = await prisma.user.findUnique({
    where: { publicSlug: slug },
    select: { id: true, bookingEnabled: true },
  });
  if (!account || !account.bookingEnabled) {
    return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });
  }

  const parsed = querySchema.safeParse({
    catalogItemId: req.nextUrl.searchParams.get("catalogItemId") ?? undefined,
    professionalId: req.nextUrl.searchParams.get("professionalId") ?? undefined,
    date: req.nextUrl.searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 400 },
    );
  }

  const [year, month, day] = parsed.data.date.split("-").map(Number);
  const fromUtc = zonedWallTimeToUtc(year!, month!, day!, 0, TZ);
  const toUtc = new Date(fromUtc.getTime() + DAY_MS);

  try {
    const slots = await getAvailableSlots(account.id, {
      catalogItemId: parsed.data.catalogItemId,
      professionalId: parsed.data.professionalId ?? null,
      fromUtc,
      toUtc,
    });
    return NextResponse.json({ slots });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao carregar horários." },
      { status: 400 },
    );
  }
}
