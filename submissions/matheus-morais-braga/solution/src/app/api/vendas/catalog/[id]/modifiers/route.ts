import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { listItemModifiers, saveItemModifiers } from "@/server/services/modifier.service";

export const dynamic = "force-dynamic";

const groupSchema = z.object({
  name: z.string().min(1),
  minSelect: z.number().int().min(0),
  maxSelect: z.number().int().min(1),
  options: z.array(z.object({
    name: z.string().min(1),
    priceDeltaCents: z.number().int().min(0),
    active: z.boolean().optional(),
  })).min(1),
});
const putSchema = z.object({ groups: z.array(groupSchema) });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ groups: await listItemModifiers(ctx.tenantUserId, id) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const { id } = await params;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    await saveItemModifiers(ctx.tenantUserId, id, parsed.data.groups);
    return NextResponse.json({ groups: await listItemModifiers(ctx.tenantUserId, id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
