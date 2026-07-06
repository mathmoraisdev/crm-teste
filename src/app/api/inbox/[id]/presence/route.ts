import { NextRequest, NextResponse } from "next/server";
import { heartbeat, stopViewing } from "@/server/services/presence.service";
import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/server/db/client";

export const dynamic = "force-dynamic";

/**
 * Heartbeat de presença: o operador que está com a conversa aberta bate aqui a
 * cada ~15s. A chave expira sozinha (~30s) se ele parar de bater. Informativo —
 * nunca trava responder.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  // Confere que o lead é da conta antes de registrar presença.
  const lead = await prisma.lead.findFirst({
    where: { id, userId: ctx.tenantUserId },
    select: { id: true },
  });
  if (!lead) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  const me = await prisma.user.findUnique({ where: { id: ctx.sessionUserId }, select: { name: true } });
  await heartbeat({
    tenantUserId: ctx.tenantUserId,
    leadId: id,
    userId: ctx.sessionUserId,
    name: me?.name ?? "Operador",
  });
  return NextResponse.json({ ok: true });
}

/** Sai da conversa (fecha/troca): remove a presença na hora. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  await stopViewing({ tenantUserId: ctx.tenantUserId, leadId: id, userId: ctx.sessionUserId });
  return NextResponse.json({ ok: true });
}
