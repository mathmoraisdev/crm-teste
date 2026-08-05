// Storage de mídia recebida do lead (imagem/PDF) no Supabase Storage.
//
// Princípios:
//  - Bucket PRIVADO: o arquivo não tem URL pública. Para baixar, o backend gera
//    uma URL ASSINADA de curta duração (createMediaSignedUrl) sob demanda.
//  - O binário NUNCA vai pro Postgres — o banco guarda só o `path` (estável) +
//    metadados; o link temporário é assinado a cada clique.
//  - Degradação segura: sem credenciais (isMediaStorageConfigured=false) as
//    funções retornam null e o chamador cai no comportamento antigo (placeholder).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isMediaStorageConfigured } from "@/lib/env";
import { cached } from "@/server/cache/cache";
import { cacheKeys } from "@/server/cache/keys";

let client: SupabaseClient | null = null;
let bucketEnsured = false;

/**
 * Cache em processo do binário de mídia (downloadMediaBuffer). O AI tool
 * `enviar_midia` re-baixa o mesmo asset da biblioteca a cada conversa; `mediaPath`
 * é write-once, então a chave é imutável e o reuso é alto. Fica em processo (não
 * no Redis) p/ evitar pressão de memória com binários e p/ devolver um Buffer
 * real (o `cached()` do Redis serializa via JSON, quebraria o Buffer). Cap + TTL
 * curto limitam o footprint; o worker Baileys é persistente, então o cache vive.
 * (Fotos de catálogo têm cache próprio em catalog-storage.ts — bucket público.)
 */
const MEDIA_BUFFER_TTL_MS = 10 * 60 * 1000; // 10 min
const MEDIA_BUFFER_MAX_ENTRIES = 100;
const mediaBufferCache = new Map<string, { buf: Buffer; exp: number }>();

function getCachedMediaBuffer(path: string): Buffer | null {
  const hit = mediaBufferCache.get(path);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    mediaBufferCache.delete(path);
    return null;
  }
  return hit.buf;
}

function setCachedMediaBuffer(path: string, buf: Buffer): void {
  mediaBufferCache.set(path, { buf, exp: Date.now() + MEDIA_BUFFER_TTL_MS });
  // Evicção simples (FIFO) ao passar do teto — guarda memória sem dependência.
  if (mediaBufferCache.size > MEDIA_BUFFER_MAX_ENTRIES) {
    const oldest = mediaBufferCache.keys().next().value;
    if (oldest) mediaBufferCache.delete(oldest);
  }
}

/** Client lazy com a service_role key (ignora RLS — uso server-only). null se
 *  o storage não estiver configurado. */
function getClient(): SupabaseClient | null {
  if (!isMediaStorageConfigured) return null;
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Garante (1x por processo) que o bucket privado existe. Idempotente: erro de
 *  "já existe" é ignorado. Não derruba o fluxo se a criação falhar — o upload
 *  seguinte é quem reporta o erro real. */
async function ensureBucket(sb: SupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  bucketEnsured = true; // marca antes do await: evita corrida criando 2x
  const { error } = await sb.storage.createBucket(env.SUPABASE_MEDIA_BUCKET, {
    public: false,
  });
  // "already exists" (ou status 409) é o caminho normal após a 1ª vez.
  if (error && !/exist/i.test(error.message)) {
    console.warn(
      `[media-storage] createBucket "${env.SUPABASE_MEDIA_BUCKET}" falhou: ${error.message}`,
    );
  }
}

/**
 * Sobe o buffer pro bucket privado. Retorna o `path` do objeto (a ser salvo na
 * Message) ou null se o storage não está configurado ou o upload falhou — nos
 * dois casos o chamador segue só com o placeholder textual. Uploader GENÉRICO:
 * serve tanto a mídia recebida do lead quanto a enviada pelo operador (o path já
 * é escopado por lead + messageKey único, sem colisão entre direções).
 */
export async function uploadInboundMedia(
  buffer: Buffer,
  opts: { leadId: string; messageKey: string; mime: string; ext: string },
): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  await ensureBucket(sb);

  // Path = leadId/messageKey.ext → agrupa por lead e evita colisão (messageKey
  // é o id WA, único). Sanitiza p/ evitar barra/".." herdados do id.
  const safeKey = opts.messageKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = `${opts.leadId}/${safeKey}.${opts.ext}`;

  const { error } = await sb.storage
    .from(env.SUPABASE_MEDIA_BUCKET)
    .upload(path, buffer, { contentType: opts.mime, upsert: true });
  if (error) {
    console.warn(`[media-storage] upload "${path}" falhou: ${error.message}`);
    return null;
  }
  return path;
}

/**
 * Baixa o binário de um objeto do bucket privado (buffer). Usado pelo worker p/
 * enviar um anexo de saída pelo chip (o web subiu o arquivo; o worker o reenvia).
 * Retorna null se o storage não está configurado ou o download falhou.
 */
export async function downloadMediaBuffer(path: string): Promise<Buffer | null> {
  const hit = getCachedMediaBuffer(path);
  if (hit) return hit;
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(env.SUPABASE_MEDIA_BUCKET).download(path);
  if (error || !data) {
    console.warn(`[media-storage] download "${path}" falhou: ${error?.message}`);
    return null;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  setCachedMediaBuffer(path, buf);
  return buf;
}

/**
 * Remove objetos do bucket privado (usado pela retenção de mídia). Retorna true
 * se a remoção rodou (ou não havia paths), false só em falha REAL de Storage —
 * nesse caso o chamador NÃO deve zerar o `mediaPath`, senão o binário vira órfão
 * ocupando disco pra sempre. Objeto inexistente NÃO é erro no Supabase (o remove
 * é idempotente). Sem storage configurado retorna false (não há o que apagar com
 * segurança; na prática não existem mediaPaths nesse cenário).
 */
export async function removeMediaObjects(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  const sb = getClient();
  if (!sb) return false;
  const { error } = await sb.storage.from(env.SUPABASE_MEDIA_BUCKET).remove(paths);
  if (error) {
    console.warn(`[media-storage] remove (${paths.length} objetos) falhou: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Gera uma URL assinada (temporária) para baixar o objeto. Retorna null se o
 * storage não está configurado ou a assinatura falhou.
 */
export async function createMediaSignedUrl(
  path: string,
  ttlSeconds = 300,
): Promise<string | null> {
  // Reusa a assinatura entre chamadas próximas (inbox: download de mídia do lead)
  // — TTL do cache fica abaixo da validade da URL p/ nunca devolver uma URL já
  // vencida. (Fotos de catálogo migraram p/ bucket público — não passam mais aqui.)
  return cached(
    cacheKeys.mediaSignedUrl(path, ttlSeconds),
    Math.max(60, ttlSeconds - 60),
    async () => {
      const sb = getClient();
      if (!sb) return null;
      const { data, error } = await sb.storage
        .from(env.SUPABASE_MEDIA_BUCKET)
        .createSignedUrl(path, ttlSeconds);
      if (error || !data) {
        console.warn(`[media-storage] signedUrl "${path}" falhou: ${error?.message}`);
        return null;
      }
      return data.signedUrl;
    },
  );
}
