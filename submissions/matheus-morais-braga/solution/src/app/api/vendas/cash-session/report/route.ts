import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { listSessionReport } from "@/server/services/cash-session.service";

export const dynamic = "force-dynamic";

// Relatório de sessões FECHADAS da conta (conferência por turno). Qualquer operador
// logado vê — é ferramenta operacional, não financeira restrita.
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json({ sessions: await listSessionReport(ctx.tenantUserId) });
}
