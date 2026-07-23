import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { findByBarcode } from "@/server/services/catalog.service";

export const dynamic = "force-dynamic";

// Lookup do caixa: bipar/digitar um código de barras → item da conta. Leitura de
// operador (sem canSettings) — o caixa precisa. 404 quando não encontra.
export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const barcode = req.nextUrl.searchParams.get("barcode") ?? "";
  const item = await findByBarcode(ctx.tenantUserId, barcode);
  if (!item) return NextResponse.json({ error: "Código não encontrado." }, { status: 404 });
  return NextResponse.json({ item });
}
