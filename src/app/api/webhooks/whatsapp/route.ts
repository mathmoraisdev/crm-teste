import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handleInbound } from "@/server/services/conversation.service";

export const dynamic = "force-dynamic";

/**
 * GET — verificação do webhook (Meta envia hub.challenge na configuração).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * POST — inbound real. Extrai as mensagens do payload do Graph API e
 * delega cada uma à orquestração (que faz dedupe por providerMessageId).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  try {
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages ?? [];
        for (const msg of messages) {
          if (msg.type !== "text") continue;
          await handleInbound({
            phone: `+${msg.from}`,
            text: msg.text?.body ?? "",
            providerMessageId: msg.id,
          });
        }
      }
    }
  } catch (e) {
    // Webhooks devem responder 200 mesmo com erro pontual, p/ evitar reentrega
    // em loop; logamos para depuração.
    console.error("Erro processando webhook WhatsApp:", e);
  }

  return NextResponse.json({ received: true });
}
