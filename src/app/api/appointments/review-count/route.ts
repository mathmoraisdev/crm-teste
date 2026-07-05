import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Contador de agendamentos aguardando revisão (needsReview=true) da conta.
 * Alimenta o badge "Agenda" na Sidebar (polling). Mesmo escopo por conta
 * (`lead.userId = tenantUserId`) usado no restante das rotas de appointment.
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ count: 0 }, { status: 401 });
  const count = await prisma.appointment.count({
    where: { needsReview: true, lead: { userId: ctx.tenantUserId } },
  });
  return NextResponse.json({ count });
}
