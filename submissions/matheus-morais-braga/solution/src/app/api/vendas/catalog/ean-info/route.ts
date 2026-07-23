import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { lookupEan } from "@/server/services/ean-lookup.service";

export const dynamic = "force-dynamic";

// Sugerir nome no cadastro: bipar/digitar um EAN → nome+marca da base externa.
// Só quem cadastra (canSettings). Sempre 200 { found } — o front decide usar ou não.
export async function GET(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.perms.canSettings) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const barcode = req.nextUrl.searchParams.get("barcode") ?? "";
  const info = await lookupEan(barcode);
  return NextResponse.json({ found: info.found, name: info.name, brand: info.brand });
}
