import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { handleInbound } from "@/server/services/conversation.service";
import { applyStatuses, applyQualityUpdate } from "@/server/services/webhook.service";
import { logger } from "@/lib/logger";

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
 * Valida a assinatura `X-Hub-Signature-256` (HMAC SHA-256 do corpo bruto com o
 * App Secret). Só roda quando `WHATSAPP_APP_SECRET` está setado — em mock/dev
 * sem secret a validação é pulada para não atrapalhar o desenvolvimento.
 */
function isValidSignature(raw: string, signature: string | null): boolean {
  if (!env.WHATSAPP_APP_SECRET) return true;
  if (!signature) return false;
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", env.WHATSAPP_APP_SECRET)
      .update(raw)
      .digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST — inbound real. Valida a assinatura, então processa do payload do Graph
 * API: status de entrega (`statuses`), atualização de qualidade do número e as
 * mensagens inbound (que passam pela orquestração com dedupe por id).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!isValidSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: any = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  try {
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        await applyStatuses(change.value?.statuses ?? []);
        if (
          change.field === "phone_number_quality_update" ||
          change.value?.quality_rating
        ) {
          await applyQualityUpdate(change.value ?? {});
        }

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
    logger.error({ err: e }, "Erro processando webhook WhatsApp");
  }

  return NextResponse.json({ received: true });
}
