import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { ReportsPanel } from "@/components/vendas/ReportsPanel";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  const canEdit = ctx.perms.canFinance; // saldo/despesas/margem nos relatórios dependem de canFinance
  return (
    <div className="mx-auto max-w-[960px]">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Relatórios</h1>
        <p className="mt-1 text-sm text-slate-500">Faturamento, ticket médio e desempenho do caixa por período.</p>
      </header>
      <ReportsPanel canEdit={canEdit} />
    </div>
  );
}
