import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { updateCatalogItem, deleteCatalogItem } from "@/server/services/catalog.service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().optional(),
  priceCents: z.number().int().optional(),
  kind: z.enum(["SERVICO", "PRODUTO"]).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const item = await updateCatalogItem(ctx.tenantUserId, id, parsed.data);
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  try {
    await deleteCatalogItem(ctx.tenantUserId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
