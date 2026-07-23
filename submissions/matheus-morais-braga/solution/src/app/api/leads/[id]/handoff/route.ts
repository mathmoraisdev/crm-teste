import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setHandoff } from "@/server/services/conversation.service";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const handoffSchema = z.object({
  paused: z.boolean(),
});

/**
 * Handoff humano: pausa/retoma a IA para um lead. Quando paused=true o operador
 * assume a conversa e a orquestração de IA deixa de responder automaticamente.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = handoffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }
  try {
    const lead = await setHandoff(id, userId, parsed.data.paused);
    return NextResponse.json({ lead });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao assumir conversa" },
      { status: 400 },
    );
  }
}
