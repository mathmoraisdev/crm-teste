import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { listStock } from "@/server/services/stock.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const items = await listStock(ctx.tenantUserId);
  return NextResponse.json({ items }); // cada item traz `low`; o UI conta os baixos
}
