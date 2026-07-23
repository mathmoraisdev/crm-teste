import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { handleInbound, ingestInboundMedia } from "@/server/services/conversation.service";
import { cloudApiMediaPlaceholder } from "@/server/whatsapp/baileys/media";
import { applyStatuses, applyQualityUpdate } from "@/server/services/webhook.service";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Em modo Cloud API a validação de assinatura é OBRIGATÓRIA (fail-closed):
 *  sem `WHATSAPP_APP_SECRET` o POST é rejeitado, nunca aceito. Nos modos mock/
 *  baileys o webhook do Graph API não está no ar, então a ausência do secret é
 *  tolerada (fail-open) só para não atrapalhar o dev. */
const REQUIRE_SIGNATURE = env.WHATSAPP_MODE === "cloud-api";

/**
 * GET — verificação do webhook (Meta envia hub.challenge na configuração).
 * Requer `WHATSAPP_VERIFY_TOKEN` não-vazio; token vazio = 403 (não há fallback).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (
    env.WHATSAPP_VERIFY_TOKEN.length > 0 &&
    mode === "subscribe" &&
    token === env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Valida a assinatura `X-Hub-Signature-256` (HMAC SHA-256 do corpo bruto com o
 * App Secret). Em modo Cloud API exige o secret (fail-closed); nos demais modos
 * sem secret a validação é pulada (webhook não está no ar em mock/baileys).
 */
function isValidSignature(raw: string, signature: string | null): boolean {
  if (!env.WHATSAPP_APP_SECRET) return !REQUIRE_SIGNATURE;
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
          if (msg.type === "text") {
            await handleInbound({
              phone: `+${msg.from}`,
              text: msg.text?.body ?? "",
              providerMessageId: msg.id,
            });
            continue;
          }
          // Mídia: imagem/vídeo/doc podem vir COM legenda (em msg[type].caption) →
          // usa a legenda como texto e aciona a IA. Sem legenda, persiste só um
          // placeholder no inbox (operador vê que chegou algo); a IA não lê mídia.
          const caption: string = (msg?.[msg.type]?.caption ?? "").trim();
          if (caption) {
            await handleInbound({ phone: `+${msg.from}`, text: caption, providerMessageId: msg.id });
            continue;
          }
          const placeholder = cloudApiMediaPlaceholder(msg.type);
          if (placeholder) {
            await ingestInboundMedia({ phone: `+${msg.from}`, placeholder, providerMessageId: msg.id });
          }
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
