// Storage de fotos de catálogo (cardápio online) no Supabase Storage.
//
// Diferente do media-storage (bucket PRIVADO, URL assinada): fotos de catálogo
// precisam de URL PÚBLICA e estável — o cardápio é uma página pública (/cardapio)
// e assinar 1 URL por item por visitante era o maior ofensor de egress de Storage
// (sem cache CDN, cada visitante baixava o binário). Bucket público + getPublicUrl
// resolve: a CDN do Supabase cacheia o binário na edge (cacheControl: "3600").
//
// O `mediaPath` no DB (<accountId>/<uuid>.<ext>) é o MESMO formato que o uploader
// genérico produzia — então a migração só copia objetos entre buckets no mesmo path,
// sem reescrever o banco. Reusa as mesmas credenciais (isMediaStorageConfigured).

import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isMediaStorageConfigured } from "@/lib/env";

const BUCKET = env.SUPABASE_CATALOG_BUCKET ?? "catalog-media";
let client: SupabaseClient | null = null;
let ensured = false;

function getClient(): SupabaseClient | null {
  if (!isMediaStorageConfigured) return null;
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Garante (1x por processo) que o bucket público existe. Idempotente: erro de
 *  "já existe" é ignorado, igual ao branding-storage. */
async function ensureBucket(sb: SupabaseClient): Promise<void> {
  if (ensured) return;
  ensured = true; // marca antes do await: evita corrida criando 2x
  const { error } = await sb.storage.createBucket(BUCKET, { public: true });
  if (error && !/exist/i.test(error.message)) {
    console.warn(`[catalog-storage] createBucket falhou: ${error.message}`);
  }
}

/**
 * Sobe a foto pro bucket público. Retorna o `mediaPath` (a ser salvo na
 * CatalogItemPhoto) ou null se o storage não está configurado ou o upload falhou.
 * Path = <accountId>/<uuid>.<ext> — mesmo formato do uploader genérico antigo,
 * para que o backfill só copie objetos entre buckets sem reescrever o DB.
 */
export async function uploadCatalogPhoto(
  buffer: Buffer,
  opts: { accountId: string; ext: string; mime: string },
): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  await ensureBucket(sb);
  const path = `${opts.accountId}/${crypto.randomUUID()}.${opts.ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType: opts.mime,
    upsert: true,
    cacheControl: "3600", // instrui a CDN do Supabase a cachear na edge por 1h
  });
  if (error) {
    console.warn(`[catalog-storage] upload "${path}" falhou: ${error.message}`);
    return null;
  }
  return path;
}

/**
 * Devolve a URL pública (CDN) do objeto. SÍNCRONO — getPublicUrl não faz rede,
 * só monta a URL. Retorna null se o storage não está configurado. Substitui o
 * createMediaSignedUrl do media-storage para fotos de catálogo.
 */
export function getCatalogPublicUrl(path: string): string | null {
  const sb = getClient();
  if (!sb) return null;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Cache em processo do binário de fotos de catálogo (downloadCatalogBuffer). O
 * AI tool `enviar_fotos` re-baixa as fotos de um item a cada conversa; o path é
 * write-once, então a chave é imutável e o reuso é alto. Mesmo padrão do
 * media-storage (Map + TTL + cap), em processo pra devolver um Buffer real.
 */
const CATALOG_BUFFER_TTL_MS = 10 * 60 * 1000; // 10 min
const CATALOG_BUFFER_MAX_ENTRIES = 100;
const bufferCache = new Map<string, { buf: Buffer; exp: number }>();

function getCachedBuffer(path: string): Buffer | null {
  const hit = bufferCache.get(path);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    bufferCache.delete(path);
    return null;
  }
  return hit.buf;
}

function setCachedBuffer(path: string, buf: Buffer): void {
  bufferCache.set(path, { buf, exp: Date.now() + CATALOG_BUFFER_TTL_MS });
  // Evicção simples (FIFO) ao passar do teto — guarda memória sem dependência.
  if (bufferCache.size > CATALOG_BUFFER_MAX_ENTRIES) {
    const oldest = bufferCache.keys().next().value;
    if (oldest) bufferCache.delete(oldest);
  }
}

/**
 * Baixa o binário de uma foto de catálogo (buffer). Usado pelo AI tool
 * `enviar_fotos` pra reenviar a foto pelo WhatsApp. Retorna null se o storage
 * não está configurado ou o download falhou.
 */
export async function downloadCatalogBuffer(path: string): Promise<Buffer | null> {
  const hit = getCachedBuffer(path);
  if (hit) return hit;
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) {
    console.warn(`[catalog-storage] download "${path}" falhou: ${error?.message}`);
    return null;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  setCachedBuffer(path, buf);
  return buf;
}

/**
 * Remove fotos do bucket público (usado ao deletar uma foto de catálogo).
 * Retorna true se a remoção rodou (ou não havia paths), false só em falha REAL
 * de Storage — nesse caso o chamador NÃO deve zerar o `mediaPath`, senão o
 * binário vira órfão. Objeto inexistente NÃO é erro no Supabase (idempotente).
 */
export async function removeCatalogObjects(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  const sb = getClient();
  if (!sb) return false;
  const { error } = await sb.storage.from(BUCKET).remove(paths);
  if (error) {
    console.warn(`[catalog-storage] remove (${paths.length} objetos) falhou: ${error.message}`);
    return false;
  }
  return true;
}

/** Expõe o nome do bucket (usado pelo script de backfill). */
export const CATALOG_BUCKET_NAME = BUCKET;
