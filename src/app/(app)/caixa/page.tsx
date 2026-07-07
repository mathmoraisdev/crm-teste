import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { VendasWorkspace } from "@/components/vendas/VendasWorkspace";

export const dynamic = "force-dynamic";

export default async function CaixaPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  const canEdit = ctx.perms.canSettings; // registrar comanda não exige; o header de saldo sim
  return (
    <div className="mx-auto max-w-[960px]">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">Caixa</h1>
        <p className="mt-1 text-sm text-slate-500">
          Registre as comandas do dia e acompanhe o pulso do caixa.
        </p>
      </header>
      <VendasWorkspace canEdit={canEdit} />
    </div>
  );
}
