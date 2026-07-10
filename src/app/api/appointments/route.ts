import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { AppointmentStatus } from "@prisma/client";
import { createAppointment, createSeries, listAppointments } from "@/server/services/appointment.service";
import { resolveOrCreateLightLead } from "@/server/services/lead.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const STATUSES = ["AGENDADO", "CONFIRMADO", "REALIZADO", "FALTOU", "CANCELADO"] as const;

/** Parseia data da query; ignora valor inválido (não deixa `Invalid Date` chegar no Prisma → 500). */
function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Mapeia erros do serviço para HTTP. Conflito de slot (CONFLICT:) e fora do
 * expediente (OUTSIDE_HOURS:) viram 409 com `kind` — deixa a UI oferecer o
 * override (allowOverlap/force). Qualquer outro erro cai em 400.
 */
function errorResponse(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : "Erro ao agendar";
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

export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const items = await listAppointments(ctx.tenantUserId, {
    leadId: sp.get("leadId") ?? undefined,
    professionalId: sp.get("professionalId") ?? undefined,
    status: STATUSES.includes(status as AppointmentStatus) ? (status as AppointmentStatus) : undefined,
    from: parseDate(sp.get("from")),
    to: parseDate(sp.get("to")),
    needsReview: sp.get("needsReview") === "true" ? true : undefined,
  });
  return NextResponse.json({ items });
}

const createSchema = z
  .object({
    leadId: z.string().min(1).optional(),
    scheduledAt: z.string().datetime({ message: "Data/hora inválida" }),
    catalogItemId: z.string().nullish(),
    serviceName: z.string().nullish(),
    professionalId: z.string().nullish(),
    durationMinutes: z.number().int().nullish(),
    customerName: z.string().nullish(),
    customerPhone: z.string().nullish(),
    allowOverlap: z.boolean().optional(),
    force: z.boolean().optional(),
    note: z.string().nullish(),
    series: z
      .object({ everyDays: z.number().int().positive(), count: z.number().int().min(1).max(52) })
      .optional(),
  })
  // Ou cliente cadastrado (leadId), ou walk-in (customerName): um dos dois é obrigatório.
  .refine((d) => Boolean(d.leadId) || Boolean(d.customerName?.trim()), {
    message: "Informe o cliente ou o nome do cliente.",
    path: ["leadId"],
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
  const {
    leadId,
    scheduledAt,
    catalogItemId,
    serviceName,
    professionalId,
    durationMinutes,
    customerName,
    customerPhone,
    allowOverlap,
    force,
    note,
    series,
  } = parsed.data;
  // Walk-in COM telefone → materializa o contato (vira Lead/Cliente), igual ao
  // agendamento público. Sem telefone (só nome) segue walk-in "adicionar rápido".
  // Telefone inválido ou teto de contatos estourado → cai de volta p/ walk-in.
  let effectiveLeadId = leadId ?? null;
  if (!effectiveLeadId && customerPhone?.trim()) {
    try {
      const lead = await resolveOrCreateLightLead(
        ctx.tenantUserId,
        { name: customerName?.trim() || customerPhone, phone: customerPhone },
        "manual",
      );
      if (lead) effectiveLeadId = lead.id;
    } catch {
      /* telefone inválido → mantém o walk-in por nome */
    }
  }
  const base = {
    leadId: effectiveLeadId,
    scheduledAt: new Date(scheduledAt),
    catalogItemId: catalogItemId ?? null,
    serviceName: serviceName ?? null,
    professionalId: professionalId ?? null,
    durationMinutes: durationMinutes ?? null,
    customerName: customerName ?? null,
    customerPhone: customerPhone ?? null,
    allowOverlap,
    force,
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
    return errorResponse(e);
  }
}
