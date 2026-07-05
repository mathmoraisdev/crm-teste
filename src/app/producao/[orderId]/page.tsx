import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { getKitchenOrder } from "@/server/services/order.service";
import { buildKitchenTickets } from "@/lib/receipt/kitchen";
import { KitchenTicketDocument } from "@/components/vendas/KitchenTicketDocument";
import { AutoPrint } from "./AutoPrint";

export const dynamic = "force-dynamic";

// Comandas de produção (N3), um ticket por setor. ?print=1 imprime automático.
export default async function ProducaoPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  const { orderId } = await params;
  const sp = await searchParams;

  let tickets;
  try {
    const order = await getKitchenOrder(ctx.tenantUserId, orderId);
    tickets = buildKitchenTickets(order);
  } catch {
    notFound();
  }

  if (tickets.length === 0) {
    return <div className="kticket">Nenhum item com setor de produção nesta comanda.</div>;
  }

  return (
    <>
      {tickets.map((t) => (
        <KitchenTicketDocument key={t.sector} ticket={t} />
      ))}
      {sp.print ? <AutoPrint /> : null}
    </>
  );
}
