import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleInbound } from "@/server/services/conversation.service";
import { getCurrentUserId } from "@/lib/session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    leadId: z.string().min(1).optional(),
    whatsAppNumberId: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    text: z.string().min(1, "Mensagem vazia"),
  })
  .refine((d) => !!d.leadId || (!!d.whatsAppNumberId && !!d.phone), {
    message: "Informe leadId, ou whatsAppNumberId + phone.",
  });

/**
 * (Somente demo local) Simula o lead respondendo. Gera um providerMessageId
 * sintético e injeta no MESMO pipeline do webhook real — incluindo o dedupe —
 * para o avaliador exercitar o fluxo de IA sem WhatsApp de verdade.
 */
export async function POST(req: NextRequest) {
  // Backstop de segurança: esta rota SIMULA o lead respondendo (injeta INBOUND).
  // Só faz sentido no modo mock (dev/avaliador). Em produção (baileys/cloud-api)
  // ela fica trancada — senão uma resposta do operador viraria "recebida do lead".
  if (env.WHATSAPP_MODE !== "mock") {
    return NextResponse.json(
      { error: "Rota de simulação disponível apenas no modo mock." },
      { status: 403 },
    );
  }
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 },
    );
  }

  try {
    const { leadId, whatsAppNumberId, phone, text } = parsed.data;
    const providerMessageId = `sim-${leadId ?? phone}-${Date.now()}`;
    const result = await handleInbound({
      leadId,
      whatsAppNumberId,
      phone,
      userId,
      text,
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
