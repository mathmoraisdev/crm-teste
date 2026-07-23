import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { OnlineOrdersBoard } from "@/components/delivery/OnlineOrdersBoard";

export const dynamic = "force-dynamic";

// Fila de pedidos online (cardápio público). O board é todo client-side: faz
// polling da API e dispara as ações (confirmar/recusar/avançar). Não há dado
// pré-carregado no servidor — a primeira renderização busca no client.
export default async function PedidosPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[26px]">
          Pedidos online
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Acompanhe e gerencie os pedidos que chegam pelo cardápio online.
        </p>
      </header>
      <OnlineOrdersBoard />
    </div>
  );
}
