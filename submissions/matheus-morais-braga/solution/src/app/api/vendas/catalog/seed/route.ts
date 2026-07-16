import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { seedCatalogFromTemplate } from "@/server/services/catalog.service";

export const dynamic = "force-dynamic";

const seedSchema = z.object({ templateId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = seedSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const items = await seedCatalogFromTemplate(ctx.tenantUserId, parsed.data.templateId);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao aplicar modelo" }, { status: 400 });
  }
}
