import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/lib/tenant";
import { closeSession, getSession, sessionSummary } from "@/server/services/cash-session.service";

export const dynamic = "force-dynamic";

const closeSchema = z.object({
  countedCents: z.number().int().min(0),
});

// Fechar caixa (conferência cega): grava o contado e revela esperado/diferença.
// Fechar a sessão de OUTRO operador exige canSettings; a própria, qualquer operador.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const session = await getSession(ctx.tenantUserId, id);
  if (!session) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  if (session.openedById !== ctx.sessionUserId && !ctx.perms.canSettings) {
    return NextResponse.json({ error: "Sem permissão para fechar o caixa de outro operador" }, { status: 403 });
  }

  try {
    await closeSession(ctx.tenantUserId, id, ctx.sessionUserId, parsed.data.countedCents);
    // Só agora (após gravar o contado) o esperado/diferença é revelado.
    const summary = await sessionSummary(ctx.tenantUserId, id);
    return NextResponse.json({ summary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 400 });
  }
}
