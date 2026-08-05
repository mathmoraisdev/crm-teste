/**
 * Backfill: copia fotos de catálogo existentes do bucket PRIVADO (whatsapp-media)
 * para o bucket PÚBLICO (catalog-media), no MESMO path. Roda após o deploy do
 * código que reponta uploads novos pro bucket público — sem ele, fotos cadastradas
 * antes da migração quebram (o `mediaPath` agora resolve no bucket público).
 *
 * Idempotente: usa upsert no destino, então re-rodar não duplica nem erro.
 * NÃO deleta as origens do bucket privado — deixa como fallback; a limpeza
 * pode ser manual depois de confirmar que tudo funciona.
 *
 * Uso:
 *   npm run backfill:catalog
 *   # ou apontando para produção:
 *   $env:DATABASE_URL="<prod direct url>"; npx tsx --env-file-if-exists=.env scripts/backfill-catalog-photos.ts
 */
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/server/db/client";
import { env, isMediaStorageConfigured } from "@/lib/env";
import { CATALOG_BUCKET_NAME } from "@/server/storage/catalog-storage";

async function main() {
  if (!isMediaStorageConfigured) {
    console.error("❌ Supabase Storage não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).");
    process.exit(1);
  }

  // Client com service_role (ignora RLS — server-only).
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Garante que o bucket público de destino existe (idempotente).
  const { error: createErr } = await sb.storage.createBucket(CATALOG_BUCKET_NAME, {
    public: true,
  });
  if (createErr && !/exist/i.test(createErr.message)) {
    console.warn(`⚠️  createBucket "${CATALOG_BUCKET_NAME}" falhou: ${createErr.message}`);
  }

  // Lista todos os mediaPaths distintos de fotos de catálogo no DB.
  const photos = await prisma.catalogItemPhoto.findMany({
    select: { mediaPath: true },
    distinct: ["mediaPath"],
  });
  console.log(`\n📦 ${photos.length} foto(s) de catálogo para migrar.`);
  console.log(`   Origem:  bucket privado "${env.SUPABASE_MEDIA_BUCKET}"`);
  console.log(`   Destino: bucket público "${CATALOG_BUCKET_NAME}"\n`);

  if (photos.length === 0) {
    console.log("✅ Nada para migrar.\n");
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < photos.length; i++) {
    const path = photos[i].mediaPath;
    process.stdout.write(`  [${i + 1}/${photos.length}] ${path} ... `);

    // Baixa do bucket privado.
    const { data, error: dlErr } = await sb.storage
      .from(env.SUPABASE_MEDIA_BUCKET)
      .download(path);
    if (dlErr || !data) {
      console.log(`⏭️  origem não encontrada (skip) — ${dlErr?.message ?? "sem dados"}`);
      skipped++;
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());

    // Sobe pro bucket público no mesmo path (upsert = idempotente).
    const { error: upErr } = await sb.storage
      .from(CATALOG_BUCKET_NAME)
      .upload(path, buffer, { upsert: true, cacheControl: "3600" });
    if (upErr) {
      console.log(`❌ upload falhou — ${upErr.message}`);
      failed++;
      continue;
    }
    console.log("✅");
    ok++;
  }

  console.log(`\nResumo: ${ok} ok, ${skipped} skip (origem ausente), ${failed} falha(s).`);
  console.log("As origens do bucket privado NÃO foram deletadas (fallback).");
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
