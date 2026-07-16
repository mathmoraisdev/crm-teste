import { NextRequest, NextResponse } from "next/server";
import { getTenantUserId } from "@/lib/tenant";
import { createMediaAsset, listMediaAssets } from "@/server/services/media-asset.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Teto alinhado ao anexo de saída do WhatsApp (imagem ~16MB; PDF/documento comum).
const MAX_BYTES = 16 * 1024 * 1024;

// A IA só envia mídia VISUAL (foto/PDF/tabela). Áudio/vídeo ficam de fora do v1.
const DOC_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** image/* ou doc conhecido → aceito; senão null (rejeita). */
function accepts(mime: string): boolean {
  return mime.startsWith("image/") || DOC_MIMES.has(mime);
}

/** Lista a biblioteca de mídia da conta. */
export async function GET() {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const assets = await listMediaAssets(userId);
    return NextResponse.json({ assets });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao listar mídias" },
      { status: 400 },
    );
  }
}

/** Sobe um arquivo à biblioteca. Multipart: file (obrigatório) + label (rótulo). */
export async function POST(req: NextRequest) {
  const userId = await getTenantUserId();
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo acima de 16MB" }, { status: 400 });
  }
  const mime = file.type || "application/octet-stream";
  if (!accepts(mime)) {
    return NextResponse.json({ error: "Tipo não suportado (use imagem ou PDF/documento)" }, { status: 400 });
  }
  const label = (form?.get("label")?.toString() ?? "").trim() || file.name;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await createMediaAsset(userId, { label, buffer, mime, fileName: file.name });
    return NextResponse.json({ asset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao subir mídia";
    // Storage indisponível é 503 (config), não erro do cliente.
    const status = /Storage/i.test(msg) ? 503 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
