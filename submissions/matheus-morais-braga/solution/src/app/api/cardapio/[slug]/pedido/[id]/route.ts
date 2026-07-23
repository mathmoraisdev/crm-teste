import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { rateLimit } from "@/lib/ratelimit";
import { getPublicOrderTracking } from "@/server/services/order-tracking.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Acompanhamento público do pedido (sem login). Resolve a conta pelo slug +
// menuEnabled (404 idêntico p/ inexistente/desligado) e devolve só o status de
// fulfillment + total + Pix (se pendente). Rate-limited por IP+slug+id.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;

  const rl = await rateLimit(`menu:track:${clientIp(_req)}:${slug}:${id}`, 30, 60);
  if (!rl.ok) {
    return NextResponse.json({ error: "Muitas consultas. Aguarde um momento." }, { status: 429 });
  }

  const account = await prisma.user.findUnique({
    where: { publicSlug: slug },
    select: { id: true, menuEnabled: true },
  });
  if (!account || !account.menuEnabled) {
    return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });
  }

  const tracking = await getPublicOrderTracking(account.id, id);
  if (!tracking) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }
  return NextResponse.json(tracking);
}
