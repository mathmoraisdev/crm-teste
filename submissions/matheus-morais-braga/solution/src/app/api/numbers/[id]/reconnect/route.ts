import { NextRequest, NextResponse } from "next/server";
import { reconnectWhatsAppNumber } from "@/server/services/numbers.service";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reconecta (repareia) um número offline: apaga as credenciais mortas e volta
 * o status p/ CONNECTING. O worker gera um QR novo. Todas as configs do número
 * (system prompt, modelo, persona…) são preservadas — ficam em outra tabela.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas o administrador da conta gerencia os números." },
      { status: 403 },
    );
  }
  const { id } = await params;
  try {
    await reconnectWhatsAppNumber(id, ctx.tenantUserId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao reconectar número" },
      { status: 400 },
    );
  }
}
