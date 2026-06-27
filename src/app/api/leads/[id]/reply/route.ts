import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendManualReply } from "@/server/services/conversation.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const replySchema = z.object({
  content: z.string().trim().min(1, "Mensagem obrigatória"),
});

/**
 * Resposta manual do operador (handoff humano): envia uma mensagem OUTBOUND ao
 * lead pelo mesmo chip e persiste como Message(OUTBOUND).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    await sendManualReply(id, userId, parsed.data.content);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao enviar resposta" },
      { status: 400 },
    );
  }
}
