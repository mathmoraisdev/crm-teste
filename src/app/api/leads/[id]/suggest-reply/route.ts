import { NextRequest, NextResponse } from "next/server";
import { suggestAttendanceReply } from "@/server/services/conversation.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Sugestão de resposta da IA para o operador (handoff humano). Gera um rascunho
 * reusando o motor de atendimento e devolve o texto — NÃO envia ao lead. Debita
 * cota de IA como uma resposta normal (BYOK não conta; plataforma respeita teto).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  try {
    const suggestion = await suggestAttendanceReply(id, userId);
    return NextResponse.json({ suggestion });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao sugerir resposta" },
      { status: 400 },
    );
  }
}
