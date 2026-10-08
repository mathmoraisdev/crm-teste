import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Conversão de áudio → nota de voz do WhatsApp (ogg/opus), no worker.
 *
 * Por que existe: o Chrome grava em `audio/webm;codecs=opus`, mas a nota de voz
 * redonda (PTT) do WhatsApp é `audio/ogg;codecs=opus`. Sem converter, o Baileys
 * enviaria um arquivo reproduzível (não a bolinha redonda). Esta função normaliza
 * qualquer formato de entrada para ogg/opus antes do envio pelo chip.
 *
 * Idempotente: se a entrada já for ogg (Firefox grava direto em ogg/opus), retorna
 * o buffer intacto — não re-codifica (evita perda de qualidade e CPU desnecessária).
 *
 * Roda só no worker (processo persistente do Railway): o binário `ffmpeg-static`
 * (~70MB) fica no worker, nunca no app web Vercel. O app web nunca importa este módulo.
 */

// Caminho do binário ffmpeg empacotado pelo npm. Setado uma vez por processo.
ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);

/** Resultado da conversão: buffer + mime que deve ir ao pool.send. */
export interface ConvertedVoiceNote {
  buffer: Buffer;
  mime: string;
}

/**
 * True se o mime já é um container ogg (provavelmente opus, formato nativo de
 * nota de voz do WhatsApp). Usado para pular a conversão (idempotência).
 */
export function isOggOpus(mime: string): boolean {
  return mime.toLowerCase().startsWith("audio/ogg");
}

/** Deriva extensão curta e segura do mime (ex.: "audio/webm" → "webm"). */
function mimeToExt(mime: string): string {
  const base = mime.split(";")[0].split("/")[1]?.split("+")[0] ?? "bin";
  const clean = base.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return clean || "bin";
}

/**
 * Converte um buffer de áudio (qualquer formato comum) para `audio/ogg;codecs=opus`,
 * o formato de nota de voz do WhatsApp. Idempotente: ogg/opus de entrada volta intacto.
 *
 * Estratégia: tmpfile no `os.tmpdir()` (mais robusto que stream puro com fluent-ffmpeg
 * para buffers curtos de nota de voz). Cleanup sempre, mesmo em falha — nunca deixa
 * órfão em disco. Em erro, lança (o OutboundJob falha e retenta, como outros jobs;
 * nunca envia áudio quebrado).
 */
export async function toVoiceNoteOgg(
  buffer: Buffer,
  mime: string,
): Promise<ConvertedVoiceNote> {
  if (isOggOpus(mime)) return { buffer, mime };

  const id = randomUUID();
  const ext = mimeToExt(mime);
  const inputPath = path.join(os.tmpdir(), `vn-in-${id}.${ext}`);
  const outputPath = path.join(os.tmpdir(), `vn-out-${id}.ogg`);

  try {
    await fs.writeFile(inputPath, buffer);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        // libopus = codec de fala do WhatsApp; mono + 32kbps é o teto p/ voz
        // (limpa estéreo inútil de microfone e mantém nota de voz pequena).
        .outputOptions("-c:a", "libopus", "-b:a", "32k", "-ac", "1")
        .outputFormat("ogg")
        .on("start", () => {})
        .on("end", () => resolve())
        .on("error", (err) =>
          reject(new Error(`ffmpeg falhou ao converter áudio: ${err.message}`)),
        )
        .save(outputPath);
    });
    const out = await fs.readFile(outputPath);
    return { buffer: out, mime: "audio/ogg;codecs=opus" };
  } finally {
    // Sempre limpa os tmpfiles, mesmo se a conversão lançou antes de salvar.
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
