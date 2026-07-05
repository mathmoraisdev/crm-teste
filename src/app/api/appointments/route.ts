import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { AppointmentStatus } from "@prisma/client";
import { createAppointment, createSeries, listAppointments } from "@/server/services/appointment.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const STATUSES = ["AGENDADO", "CONFIRMADO", "REALIZADO", "FALTOU", "CANCELADO"] as const;

/** Parseia data da query; ignora valor inválido (não deixa `Invalid Date` chegar no Prisma → 500). */
function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const items = await listAppointments(ctx.tenantUserId, {
    leadId: sp.get("leadId") ?? undefined,
    status: STATUSES.includes(status as AppointmentStatus) ? (status as AppointmentStatus) : undefined,
    from: parseDate(sp.get("from")),
    to: parseDate(sp.get("to")),
  });
  return NextResponse.json({ items });
}

const createSchema = z.object({
  leadId: z.string().min(1, "Cliente obrigatório"),
  scheduledAt: z.string().datetime({ message: "Data/hora inválida" }),
  catalogItemId: z.string().nullish(),
  serviceName: z.string().nullish(),
  note: z.string().nullish(),
  series: z
    .object({ everyDays: z.number().int().positive(), count: z.number().int().min(1).max(52) })
    .optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  const { leadId, scheduledAt, catalogItemId, serviceName, note, series } = parsed.data;
  const base = {
    leadId,
    scheduledAt: new Date(scheduledAt),
    catalogItemId: catalogItemId ?? null,
    serviceName: serviceName ?? null,
    note: note ?? null,
    createdById: ctx.sessionUserId,
  };
  try {
    if (series) {
      const result = await createSeries(ctx.tenantUserId, base, series);
      return NextResponse.json(result, { status: 201 });
    }
    const appointment = await createAppointment(ctx.tenantUserId, base);
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao agendar" },
      { status: 400 },
    );
  }
}
