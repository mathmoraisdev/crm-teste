import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { listWorkingHours, setWorkingHours } from "@/server/services/professional.service";

export const dynamic = "force-dynamic";

/** id literal "default" => escopo do expediente padrão da conta (professionalId null). */
function resolveScope(id: string): string | null {
  return id === "default" ? null : id;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const rows = await listWorkingHours(ctx.tenantUserId, resolveScope(id));
  return NextResponse.json({ rows });
}

const putSchema = z.object({
  rows: z.array(z.object({
    weekday: z.number().int(),
    startMinute: z.number().int(),
    endMinute: z.number().int(),
    breakStart: z.number().int().nullish(),
    breakEnd: z.number().int().nullish(),
  })),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const rows = await setWorkingHours(ctx.tenantUserId, resolveScope(id), parsed.data.rows);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
