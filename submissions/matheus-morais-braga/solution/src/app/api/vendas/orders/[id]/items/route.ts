import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { addItem } from "@/server/services/order.service";

export const dynamic = "force-dynamic";

const addSchema = z.object({
  catalogItemId: z.string().optional(),
  name: z.string().optional(),
  unitPriceCents: z.number().int().optional(),
  quantity: z.number().int().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  modifierOptionIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const order = await addItem(ctx.tenantUserId, id, parsed.data);
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
