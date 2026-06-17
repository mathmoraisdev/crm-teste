import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleInbound } from "@/server/services/conversation.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  leadId: z.string().min(1),
  text: z.string().min(1, "Mensagem vazia"),
});

/**
 * (Somente demo local) Simula o lead respondendo. Gera um providerMessageId
 * sintético e injeta no MESMO pipeline do webhook real — incluindo o dedupe —
 * para o avaliador exercitar o fluxo de IA sem WhatsApp de verdade.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }

  try {
    const providerMessageId = `sim-${parsed.data.leadId}-${Date.now()}`;
    const result = await handleInbound({
      leadId: parsed.data.leadId,
      text: parsed.data.text,
      providerMessageId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao processar resposta" },
      { status: 500 },
    );
  }
}
