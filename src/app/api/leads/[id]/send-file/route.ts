import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { sendManualMedia } from "@/server/services/conversation.service";
import { uploadInboundMedia } from "@/server/storage/media-storage";
import { getTenantUserId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Teto de tamanho do anexo de saída. Alinhado ao limite prático da mídia do
// WhatsApp (imagem/áudio ~16MB); documentos maiores raramente passam bem.
const MAX_BYTES = 16 * 1024 * 1024;

// Documentos aceitos além de imagem/*/áudio/* (evita usar o storage como host de
// arquivo arbitrário). WhatsApp aceita muitos tipos; cobrimos os comuns.
const DOC_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

/** image/* | audio/* | doc conhecido → tipo de mídia do WhatsApp; senão null. */
function classifyMedia(mime: string): "image" | "audio" | "document" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (DOC_MIMES.has(mime)) return "document";
  return null;
}

/**
 * Envio manual de ANEXO pelo operador (handoff humano): sobe o arquivo ao storage
 * privado e envia ao lead pelo mesmo chip, persistindo como Message(OUTBOUND) com
 * o ponteiro do storage (p/ a bolha renderizar). Multipart: file (obrigatório),
 * caption (legenda opcional), replyToMessageId (citação opcional).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo acima de 16MB" }, { status: 400 });
  }
  const mime = file.type || "application/octet-stream";
  const mediaType = classifyMedia(mime);
  if (!mediaType) {
    return NextResponse.json({ error: "Tipo de arquivo não suportado" }, { status: 400 });
  }
  const caption = (form?.get("caption")?.toString() ?? "").trim() || undefined;
  const replyToMessageId = form?.get("replyToMessageId")?.toString() || undefined;

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || mime.split("/")[1] || "bin")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  // Sobe ao bucket privado ANTES de enviar: o Baileys envia via worker (que baixa
  // o buffer) e o inbox precisa do ponteiro p/ renderizar a mídia enviada depois.
  const mediaPath = await uploadInboundMedia(buffer, {
    leadId: id,
    messageKey: `out-${crypto.randomUUID()}`,
    mime,
    ext: ext || "bin",
  });
  if (!mediaPath) {
    return NextResponse.json(
      { error: "Storage de mídia indisponível" },
      { status: 503 },
    );
  }

  try {
    await sendManualMedia(
      id,
      userId,
      { buffer, mediaPath, mediaType, mediaMime: mime, fileName: file.name },
      { caption, replyToMessageId },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao enviar arquivo" },
      { status: 400 },
    );
  }
}
