import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { updateZone, deleteZone } from "@/server/services/delivery-zone.service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  feeCents: z.number().int().min(0).optional(),
  minOrderCents: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json(
      { error: "Seu usuário não tem permissão para alterar as configurações da conta." },
      { status: 403 },
    );
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const zone = await updateZone(ctx.tenantUserId, id, parsed.data);
    return NextResponse.json(zone);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao atualizar zona";
    // "Zona não encontrada" → tenant-safe (não vaza se é inexistente ou de outra conta)
    return NextResponse.json({ error: msg }, { status: /n[ãa]o encontrada/i.test(msg) ? 404 : 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) {
    return NextResponse.json(
      { error: "Seu usuário não tem permissão para alterar as configurações da conta." },
      { status: 403 },
    );
  }
  const { id } = await params;
  try {
    await deleteZone(ctx.tenantUserId, id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao excluir zona";
    return NextResponse.json({ error: msg }, { status: /n[ãa]o encontrada/i.test(msg) ? 404 : 400 });
  }
}
