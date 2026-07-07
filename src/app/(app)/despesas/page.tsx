import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { ExpensesPanel } from "@/components/vendas/ExpensesPanel";

export const dynamic = "force-dynamic";

export default async function DespesasPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  // Despesas é do dono/gerente (mesmo gate da aba no Caixa); operador não acessa.
  if (!ctx.perms.canSettings) redirect("/caixa");
  return (
    <div className="mx-auto max-w-[960px]">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Despesas</h1>
        <p className="mt-1 text-sm text-slate-500">Contas a pagar, despesas pagas e recorrências.</p>
      </header>
      <ExpensesPanel />
    </div>
  );
}
