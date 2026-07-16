// Storage do logo de branding da conta no Supabase Storage.
//
// Diferente do media-storage (bucket PRIVADO, URL assinada): logos precisam de
// URL pública e estável para <img> em toda página → bucket PÚBLICO. Reusa as
// mesmas credenciais (isMediaStorageConfigured) e degrada para null sem config.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isMediaStorageConfigured } from "@/lib/env";

const BUCKET = env.SUPABASE_BRANDING_BUCKET ?? "branding";
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

async function ensureBucket(sb: SupabaseClient) {
  if (ensured) return;
  ensured = true;
  const { error } = await sb.storage.createBucket(BUCKET, { public: true });
  if (error && !/exist/i.test(error.message)) {
    console.warn(`[branding-storage] createBucket falhou: ${error.message}`);
  }
}

/** Sobe o logo (path estável por conta) e devolve a URL pública, ou null. */
export async function uploadBrandingLogo(
  buffer: Buffer,
  opts: { accountId: string; ext: string; mime: string },
): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  await ensureBucket(sb);
  const path = `${opts.accountId}/logo.${opts.ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType: opts.mime, upsert: true, cacheControl: "3600",
  });
  if (error) {
    console.warn(`[branding-storage] upload falhou: ${error.message}`);
    return null;
  }
  // Cache-buster para refletir troca de logo mantendo path estável.
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${buffer.length}`;
}
