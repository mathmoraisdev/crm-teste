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

let client: SupabaseClient | null = null;
let bucketEnsured = false;

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
 * dois casos o chamador segue só com o placeholder textual.
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
 * Gera uma URL assinada (temporária) para baixar o objeto. Retorna null se o
 * storage não está configurado ou a assinatura falhou.
 */
export async function createMediaSignedUrl(
  path: string,
  ttlSeconds = 300,
): Promise<string | null> {
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
}
