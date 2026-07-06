import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { getOpenSession, openSession } from "@/server/services/cash-session.service";

export const dynamic = "force-dynamic";

// Estado atual do caixa: a sessão ABERTA da conta (ou null). NÃO devolve o esperado
// enquanto aberta — a conferência é cega (o esperado só aparece ao fechar).
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json({ session: await getOpenSession(ctx.tenantUserId) });
}

const openSchema = z.object({
  openingFloatCents: z.number().int().min(0),
});

// Abrir caixa: qualquer operador logado. O turno é atribuído a quem abriu.
export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = openSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  try {
    const session = await openSession(ctx.tenantUserId, ctx.sessionUserId, parsed.data.openingFloatCents);
    return NextResponse.json({ session });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
