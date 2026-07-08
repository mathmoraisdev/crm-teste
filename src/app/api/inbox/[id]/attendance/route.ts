import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/server/db/client";
import {
  claimConversation,
  takeoverConversation,
  releaseConversation,
} from "@/server/services/attendance-lock.service";

export const dynamic = "force-dynamic";

/**
 * Trava de atendimento da conversa. POST {action:"claim"|"takeover"} ao abrir/assumir;
 * DELETE ao fechar. Substitui o heartbeat de presença (que batia a cada 15s no Redis).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;

  // Escopo de tenant: a conversa é da conta?
  const lead = await prisma.lead.findFirst({
    where: { id, userId: ctx.tenantUserId },
    select: { id: true },
  });
  if (!lead) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "takeover") {
    await takeoverConversation({ leadId: id, tenantUserId: ctx.tenantUserId, userId: ctx.sessionUserId });
    return NextResponse.json({ ok: true });
  }
  const r = await claimConversation({ leadId: id, tenantUserId: ctx.tenantUserId, userId: ctx.sessionUserId });
  return NextResponse.json(r);
}

/** Sai da conversa: libera a trava (só se ainda for minha). keepalive no front. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  await releaseConversation({ leadId: id, tenantUserId: ctx.tenantUserId, userId: ctx.sessionUserId });
  return NextResponse.json({ ok: true });
}
