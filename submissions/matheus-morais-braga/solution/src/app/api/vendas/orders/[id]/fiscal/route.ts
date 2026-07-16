import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { retryFiscalEmission } from "@/server/services/fiscal-emission";

export const dynamic = "force-dynamic";

/**
 * Re-enfileira uma NFC-e em ERRO ("Tentar de novo"). É ação de CAIXA (recupera uma
 * venda cuja nota falhou) — qualquer operador autenticado pode disparar; não exige
 * canSettings. O escopo por conta (tenantUserId) é a guarda; o serviço barra status
 * != ERRO e o teto de tentativas.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    await retryFiscalEmission(ctx.tenantUserId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
