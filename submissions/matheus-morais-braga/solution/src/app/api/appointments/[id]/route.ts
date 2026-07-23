import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateAppointment, cancelAppointment } from "@/server/services/appointment.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  status: z.enum(["AGENDADO", "CONFIRMADO", "REALIZADO", "FALTOU", "CANCELADO"]).optional(),
  catalogItemId: z.string().nullish(),
  serviceName: z.string().nullish(),
  professionalId: z.string().nullish(),
  durationMinutes: z.number().int().nullish(),
  allowOverlap: z.boolean().optional(),
  force: z.boolean().optional(),
  note: z.string().nullish(),
  orderId: z.string().optional(), // ao marcar REALIZADO, liga a comanda gerada
});

/**
 * Mapeia erros do serviço para HTTP. Conflito de slot (CONFLICT:) e fora do
 * expediente (OUTSIDE_HOURS:) viram 409 com `kind` — deixa a UI oferecer o
 * override (allowOverlap/force). Qualquer outro erro cai em 400.
 */
function errorResponse(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : "Erro ao atualizar";
  if (msg.startsWith("CONFLICT:")) {
    return NextResponse.json(
      { error: msg.slice("CONFLICT:".length).trim(), kind: "CONFLICT" },
      { status: 409 },
    );
  }
  if (msg.startsWith("OUTSIDE_HOURS:")) {
    return NextResponse.json(
      { error: msg.slice("OUTSIDE_HOURS:".length).trim(), kind: "OUTSIDE_HOURS" },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  try {
    // Um caminho só: status (inclusive REALIZADO), reagendar, trocar serviço,
    // observação e/ou orderId — tudo aplicado junto, nada é descartado.
    const appointment = await updateAppointment(ctx.tenantUserId, id, {
      scheduledAt: d.scheduledAt ? new Date(d.scheduledAt) : undefined,
      status: d.status,
      catalogItemId: d.catalogItemId,
      serviceName: d.serviceName,
      professionalId: d.professionalId,
      durationMinutes: d.durationMinutes,
      allowOverlap: d.allowOverlap,
      force: d.force,
      note: d.note,
      orderId: d.orderId,
    }, ctx.sessionUserId);
    return NextResponse.json({ appointment });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const appointment = await cancelAppointment(ctx.tenantUserId, id, ctx.sessionUserId);
    return NextResponse.json({ appointment });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao cancelar" },
      { status: 400 },
    );
  }
}
