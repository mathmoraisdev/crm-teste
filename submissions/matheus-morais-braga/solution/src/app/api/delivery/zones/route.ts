import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { listZones, createZone } from "@/server/services/delivery-zone.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const zones = await listZones(ctx.tenantUserId, { includeInactive: true });
  return NextResponse.json({ zones });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do bairro/zona."),
  feeCents: z.number().int().min(0),
  minOrderCents: z.number().int().min(0).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json(
      { error: "Seu usuário não tem permissão para alterar as configurações da conta." },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const zone = await createZone(ctx.tenantUserId, parsed.data);
    return NextResponse.json(zone, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao criar zona" },
      { status: 400 },
    );
  }
}
