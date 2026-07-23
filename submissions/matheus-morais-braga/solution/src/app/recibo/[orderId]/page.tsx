import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { getReceiptData } from "@/server/services/order.service";
import { buildReceiptModel } from "@/lib/receipt/model";
import { ReceiptDocument } from "@/components/vendas/ReceiptDocument";
import { AutoPrint } from "./AutoPrint";

export const dynamic = "force-dynamic";

// Rota standalone do cupom. ?w=58 usa a bobina estreita (24 col); default 80mm
// (32 col). ?print=1 imprime automático ao montar (o iframe do Caixa usa isso).
export default async function ReciboPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ w?: string; print?: string }>;
}) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const { orderId } = await params;
  const sp = await searchParams;
  const narrow = sp.w === "58";
  const cols = narrow ? (24 as const) : (32 as const);
  const mm = narrow ? 58 : 80;
  // font-size que faz `cols` caracteres monoespaçados preencherem a bobina.
  // ~0.6em de avanço por char (aprox. de mono); ajuste fino é visual, não crítico.
  const fs = (mm / (cols * 0.6)).toFixed(2);

  let model: ReturnType<typeof buildReceiptModel>;
  try {
    const data = await getReceiptData(ctx.tenantUserId, orderId);
    model = buildReceiptModel(data.order, { ...data.business, width: cols });
  } catch {
    notFound();
  }

  const printCss = `
    .receipt { width: ${cols}ch; }
    @media print {
      @page { size: ${mm}mm auto; margin: 0; }
      .receipt { width: ${cols}ch; font-size: ${fs}mm; }
    }
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
      <ReceiptDocument model={model} />
      {sp.print ? <AutoPrint /> : null}
    </>
  );
}
