import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { getBusinessTemplateId } from "@/server/services/account.service";
import { VendasWorkspace } from "@/components/vendas/VendasWorkspace";

export const dynamic = "force-dynamic";

export default async function CaixaPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  const canEdit = ctx.perms.canSettings; // cadastrar catálogo exige canSettings; registrar comanda, não
  const businessTemplateId = await getBusinessTemplateId(ctx.tenantUserId); // ramo da conta (atalho no catálogo vazio)
  return (
    <div className="mx-auto max-w-[960px]">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Caixa</h1>
        <p className="mt-1 text-sm text-slate-500">
          Registre vendas e despesas do dia, gerencie catálogo e acompanhe o saldo.
        </p>
      </header>
      <VendasWorkspace canEdit={canEdit} accountBusinessId={businessTemplateId} />
    </div>
  );
}
