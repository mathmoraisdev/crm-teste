import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Contadores do badge "Agenda" na Sidebar (polling):
 * - `count`: agendamentos aguardando revisão (needsReview=true) → badge numérico.
 * - `onlinePending`: agendamentos vindos do link público ainda não confirmados
 *   (source ONLINE + status AGENDADO) → alimenta a bolinha de "chegou booking novo".
 * Escopo por conta (lead.userId OU accountId do walk-in), igual ao listAppointments.
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ count: 0, onlinePending: 0 }, { status: 401 });
  const owned = { OR: [{ lead: { userId: ctx.tenantUserId } }, { accountId: ctx.tenantUserId }] };
  const [count, onlinePending] = await Promise.all([
    prisma.appointment.count({ where: { needsReview: true, ...owned } }),
    prisma.appointment.count({ where: { source: "ONLINE", status: "AGENDADO", ...owned } }),
  ]);
  return NextResponse.json({ count, onlinePending });
}
