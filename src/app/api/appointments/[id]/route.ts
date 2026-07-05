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
  note: z.string().nullish(),
  orderId: z.string().optional(), // ao marcar REALIZADO, liga a comanda gerada
});

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
      note: d.note,
      orderId: d.orderId,
    });
    return NextResponse.json({ appointment });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao atualizar" },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const appointment = await cancelAppointment(ctx.tenantUserId, id);
    return NextResponse.json({ appointment });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao cancelar" },
      { status: 400 },
    );
  }
}
