// scripts/backfill-billing-override.ts
// Mapeia o estado antigo (billingActive) para o novo override, sem perder nada:
//   billingActive=true  -> billingOverride=ACTIVE  (conta segue funcionando)
//   billingActive=false -> billingOverride=SUSPENDED
// Idempotente: rode quantas vezes quiser. Roda UMA vez na migração.
import { prisma } from "@/server/db/client";

async function main() {
  const toActive = await prisma.user.updateMany({
    where: { billingActive: true },
    data: { billingOverride: "ACTIVE" },
  });
  const toSuspended = await prisma.user.updateMany({
    where: { billingActive: false },
    data: { billingOverride: "SUSPENDED" },
  });
  console.log(`ACTIVE: ${toActive.count} | SUSPENDED: ${toSuspended.count}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
