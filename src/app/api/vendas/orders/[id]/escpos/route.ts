import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { getReceiptData } from "@/server/services/order.service";
import { getPosSettings } from "@/server/services/pos-settings.service";
import { buildReceiptModel } from "@/lib/receipt/model";
import { buildEscposBytes } from "@/lib/receipt/escpos";

export const dynamic = "force-dynamic";

// Bytes ESC/POS do cupom (N2) em base64 — o qz-client no navegador só repassa ao
// QZ Tray. Montar o modelo/bytes fica no servidor (fonte de verdade única) e
// escopado por conta. ?w=58 usa a bobina estreita (24 col); default 80mm (32 col).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;

  const url = new URL(_req.url);
  const width = url.searchParams.get("w") === "58" ? (24 as const) : (32 as const);

  try {
    const [data, settings] = await Promise.all([
      getReceiptData(ctx.tenantUserId, id),
      getPosSettings(ctx.tenantUserId),
    ]);
    const model = buildReceiptModel(data.order, { ...data.business, width });
    // N2.3: gaveta só abre se configurado E o pagamento for em dinheiro.
    const openDrawer = settings.openDrawer && data.order.payment === "DINHEIRO";
    const bytes = buildEscposBytes(model, { openDrawer });
    const base64 = Buffer.from(bytes).toString("base64");
    return NextResponse.json({ data: base64, printerName: settings.printerName });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 404 });
  }
}
