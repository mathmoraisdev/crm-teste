import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { getBusinessTemplateId } from "@/server/services/account.service";
import { prisma } from "@/server/db/client";
import { CatalogManager } from "@/components/vendas/CatalogManager";

export const dynamic = "force-dynamic";

export default async function CatalogoPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  const canEdit = ctx.perms.canSettings; // cadastrar catálogo exige canSettings
  const [businessTemplateId, account] = await Promise.all([
    getBusinessTemplateId(ctx.tenantUserId), // ramo (atalho no catálogo vazio)
    prisma.user.findUnique({ where: { id: ctx.tenantUserId }, select: { menuEnabled: true } }),
  ]);
  return (
    <div className="mx-auto max-w-[960px]">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Catálogo</h1>
        <p className="mt-1 text-sm text-slate-500">Serviços e produtos vendáveis, com preço e código de barras.</p>
      </header>
      <CatalogManager
        canEdit={canEdit}
        accountBusinessId={businessTemplateId}
        menuEnabled={account?.menuEnabled ?? false}
      />
    </div>
  );
}
