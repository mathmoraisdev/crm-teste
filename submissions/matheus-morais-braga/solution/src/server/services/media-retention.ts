// Retenção de mídia: apaga o BINÁRIO antigo do Storage, preservando a Message e
// a transcrição de áudio (`content`). O inbox cai no placeholder textual — mesmo
// caminho da degradação segura que já existe quando não há mediaPath.
//
// Invariante: só zeramos `mediaPath` DEPOIS que o objeto saiu do Storage. A ordem
// evita órfão (binário no bucket sem referência = disco perdido pra sempre). Se o
// Storage falhar, paramos e retentamos no próximo ciclo do worker.

import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { removeMediaObjects } from "@/server/storage/media-storage";

const DAY_MS = 86_400_000;
const BATCH = 200; // objetos por chamada de remove (Supabase aceita bem mais; folga)
const MAX_BATCHES = 25; // teto por execução (≤5000 msgs/ciclo) p/ não segurar o loop do worker

/**
 * Apaga o binário das mensagens cuja mídia passou do TTL do seu tipo (áudio tem
 * TTL próprio: já virou texto, é o mais descartável). Não toca em Message nem em
 * `content`. Retorna quantas mensagens tiveram o binário removido. No-op se
 * MEDIA_RETENTION_DAYS <= 0.
 */
export async function purgeExpiredMedia(now: Date): Promise<number> {
  const days = env.MEDIA_RETENTION_DAYS;
  if (days <= 0) return 0; // desligado

  const audioDays = env.MEDIA_AUDIO_RETENTION_DAYS || days; // 0 = herda o geral
  const cutoffDocs = new Date(now.getTime() - days * DAY_MS);
  const cutoffAudio = new Date(now.getTime() - audioDays * DAY_MS);

  let purged = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    // Cada linha retornada JÁ está expirada pelo cutoff do seu tipo. Ordena por
    // createdAt asc (mais antigas primeiro) → drena monotonicamente: ao zerar o
    // mediaPath, a linha some do conjunto na próxima iteração. A branch explícita
    // de mediaType null cobre eventual legado (o `not` do Prisma exclui null).
    const expired = await prisma.message.findMany({
      where: {
        mediaPath: { not: null },
        OR: [
          { mediaType: "audio", createdAt: { lt: cutoffAudio } },
          { mediaType: { not: "audio" }, createdAt: { lt: cutoffDocs } },
          { mediaType: null, createdAt: { lt: cutoffDocs } },
        ],
      },
      select: { id: true, mediaPath: true },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    });
    if (expired.length === 0) break;

    const paths = expired
      .map((m) => m.mediaPath)
      .filter((p): p is string => !!p);

    // Storage indisponível/falho: aborta sem zerar nada — retenta no próximo ciclo.
    if (!(await removeMediaObjects(paths))) break;

    await prisma.message.updateMany({
      where: { id: { in: expired.map((m) => m.id) } },
      data: { mediaPath: null },
    });
    purged += expired.length;
    if (expired.length < BATCH) break; // esvaziou o lote → nada mais pendente
  }
  return purged;
}
