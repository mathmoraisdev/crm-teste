import OpenAI, { toFile } from "openai";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/** Config resolvida do provider ativo (chave SEMPRE de plataforma). */
function resolveTranscribeClient():
  | { client: OpenAI; model: string }
  | null {
  if (env.TRANSCRIBE_PROVIDER === "groq") {
    if (!env.GROQ_API_KEY) return openaiFallback();
    return {
      client: new OpenAI({
        apiKey: env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      }),
      model: env.TRANSCRIBE_MODEL_GROQ,
    };
  }
  return openaiFallback();
}

function openaiFallback(): { client: OpenAI; model: string } | null {
  if (!env.OPENAI_API_KEY) return null;
  return {
    client: new OpenAI({ apiKey: env.OPENAI_API_KEY }),
    model: env.TRANSCRIBE_MODEL_OPENAI,
  };
}

/**
 * Transcreve um buffer de áudio (nota de voz do WhatsApp, geralmente ogg/opus).
 * Retorna o texto, ou `null` em qualquer falha/sem chave — o chamador segue com
 * o comportamento antigo (placeholder + player). Trunca em `TRANSCRIBE_MAX_CHARS`.
 */
export async function transcribeAudio(
  buffer: Buffer,
  mime: string,
): Promise<string | null> {
  const resolved = resolveTranscribeClient();
  if (!resolved) return null;
  // extensão a partir do mime; opus vem como "audio/ogg; codecs=opus"
  const ext = (mime.split("/")[1]?.split(/[;+]/)[0] || "ogg").toLowerCase();
  try {
    const file = await toFile(buffer, `audio.${ext}`, { type: mime.split(";")[0] });
    const res = await resolved.client.audio.transcriptions.create({
      file,
      model: resolved.model,
      language: "pt",
    });
    const text = (res.text ?? "").trim();
    if (!text) return null;
    return text.length > env.TRANSCRIBE_MAX_CHARS
      ? text.slice(0, env.TRANSCRIBE_MAX_CHARS) + "…"
      : text;
  } catch (err) {
    logger.warn({ err, provider: env.TRANSCRIBE_PROVIDER }, "[transcribe] falha na transcrição");
    return null;
  }
}
