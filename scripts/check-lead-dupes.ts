/**
 * Pré-flight READ-ONLY para o `db push` que cria @@unique([whatsAppNumberId, phone])
 * no Lead. Lista grupos (whatsAppNumberId, phone) com mais de 1 lead — que
 * violariam o novo índice único e fariam o `db push` falhar (possivelmente no
 * meio). Não escreve nada.
 *
 * Uso (apontando para o banco que vai receber o push):
 *   # PowerShell, contra produção:
 *   $env:DATABASE_URL="<prod direct url>"; npx tsx scripts/check-lead-dupes.ts
 *
 * Leads com whatsAppNumberId = null NÃO colidem (Postgres trata NULL como
 * distinto em índice único), então são ignorados aqui.
 */
import { prisma } from "@/server/db/client";

async function main() {
  const groups = await prisma.lead.groupBy({
    by: ["whatsAppNumberId", "phone"],
    where: { whatsAppNumberId: { not: null } },
    _count: { _all: true },
  });
  const dupes = groups.filter((g) => g._count._all > 1);

  console.log(`\n🔎 Banco: ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ":****@") ?? "(DATABASE_URL ausente)"}`);
  console.log(`   Grupos (whatsAppNumberId, phone) com whatsAppNumberId != null: ${groups.length}`);

  if (dupes.length === 0) {
    console.log("\n✅ Nenhum duplicado. O `db push` do unique (whatsAppNumberId, phone) é seguro.\n");
    return;
  }

  console.log(`\n❌ ${dupes.length} grupo(s) duplicado(s) — RESOLVER antes do db push:\n`);
  for (const d of dupes) {
    console.log(`   numberId=${d.whatsAppNumberId} phone=${d.phone} → ${d._count._all} leads`);
  }
  console.log("\n   (mantenha 1 lead por grupo; mescle/remova os demais antes de aplicar o schema.)\n");
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
