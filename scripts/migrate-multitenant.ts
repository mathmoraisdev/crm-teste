import crypto from "node:crypto";
import { prisma } from "@/server/db/client";
import { hashPassword } from "@/lib/password";

/**
 * Migração multi-tenant SEM perda de dados.
 *
 * Cria a tabela `User`, garante uma conta "dona" e atribui a ela todos os
 * leads/campanhas/números já existentes. Depois ajusta as colunas para o estado
 * final (NOT NULL + uniques por conta + FKs). É a parte que o `prisma db push`
 * não consegue fazer sozinho (adicionar coluna obrigatória em tabela com linhas).
 *
 * Idempotente: pode rodar mais de uma vez sem quebrar.
 *
 * Uso: npx tsx --env-file-if-exists=.env scripts/migrate-multitenant.ts
 */
const OWNER_NAME = "Conta Demo";
const OWNER_EMAIL = "demo@disparador.ai";
const OWNER_PASSWORD = "disparador123";

const ddl = (sql: string) => prisma.$executeRawUnsafe(sql);

async function main() {
  console.log("→ criando tabela User (se não existir)…");
  await ddl(`CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whatsapp" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
  )`);
  await ddl(`CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")`);

  console.log("→ garantindo a conta dona dos dados existentes…");
  const newId = "usr_" + crypto.randomUUID().replace(/-/g, "");
  const hash = hashPassword(OWNER_PASSWORD);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "User" ("id","name","email","passwordHash","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("email") DO NOTHING`,
    newId,
    OWNER_NAME,
    OWNER_EMAIL,
    hash,
  );
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "User" WHERE "email"=$1 LIMIT 1`,
    OWNER_EMAIL,
  );
  const ownerId = rows[0]!.id;
  console.log(`  conta: ${ownerId} (${OWNER_EMAIL})`);

  for (const table of ["Lead", "Campaign", "WhatsAppNumber"]) {
    console.log(`→ ${table}: adicionando userId e fazendo backfill…`);
    await ddl(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "userId" TEXT`);
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "userId"=$1 WHERE "userId" IS NULL`,
      ownerId,
    );
    await ddl(`ALTER TABLE "${table}" ALTER COLUMN "userId" SET NOT NULL`);
  }

  console.log("→ trocando uniques de telefone (global → por conta)…");
  await ddl(`DROP INDEX IF EXISTS "Lead_phone_key"`);
  await ddl(`DROP INDEX IF EXISTS "WhatsAppNumber_phone_key"`);
  await ddl(`CREATE UNIQUE INDEX IF NOT EXISTS "Lead_userId_phone_key" ON "Lead"("userId","phone")`);
  await ddl(`CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppNumber_userId_phone_key" ON "WhatsAppNumber"("userId","phone")`);
  await ddl(`CREATE INDEX IF NOT EXISTS "Lead_userId_idx" ON "Lead"("userId")`);
  await ddl(`CREATE INDEX IF NOT EXISTS "Campaign_userId_idx" ON "Campaign"("userId")`);
  await ddl(`CREATE INDEX IF NOT EXISTS "WhatsAppNumber_userId_idx" ON "WhatsAppNumber"("userId")`);

  console.log("→ adicionando foreign keys (User)…");
  for (const t of ["Lead", "Campaign", "WhatsAppNumber"]) {
    await ddl(`DO $$ BEGIN
      ALTER TABLE "${t}" ADD CONSTRAINT "${t}_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  }

  console.log("✅ Migração multi-tenant concluída (dados preservados).");
  console.log(`   Login da conta dona: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
