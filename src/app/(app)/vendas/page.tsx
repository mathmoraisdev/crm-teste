import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { VendasWorkspace } from "@/components/vendas/VendasWorkspace";

export const dynamic = "force-dynamic";

export default async function VendasPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  const canEdit = ctx.perms.canSettings; // cadastrar catálogo exige canSettings; registrar comanda, não
  return (
    <div className="mx-auto max-w-[960px]">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Vendas</h1>
        <p className="mt-1 text-sm text-slate-500">
          Registre as vendas do dia, gerencie seu catálogo e acompanhe o faturamento.
        </p>
      </header>
      <VendasWorkspace canEdit={canEdit} />
    </div>
  );
}
