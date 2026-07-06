import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { createCatalogItem, listCatalogItems } from "@/server/services/catalog.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const items = await listCatalogItems(ctx.tenantUserId);
  return NextResponse.json({ items });
}

const createSchema = z.object({
  name: z.string(),
  priceCents: z.number().int(),
  kind: z.enum(["SERVICO", "PRODUTO"]).optional(),
  trackStock: z.boolean().optional(),
  sku: z.string().nullish(),
  barcode: z.string().nullish(),
  variantGroup: z.string().nullish(),
  minStock: z.number().int().optional(),
  costCents: z.number().int().nullish(),
  printSector: z.string().nullish(),
  durationMinutes: z.number().int().nullish(),
});

export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const item = await createCatalogItem(ctx.tenantUserId, parsed.data);
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar" }, { status: 400 });
  }
}
