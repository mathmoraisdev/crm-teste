"use client";

import type { ReceiptModel } from "@/lib/receipt/model";

// Renderizador HTML (N1) do MESMO ReceiptModel que o ESC/POS (N2) consumirá.
// Monoespaçado + whitespace-pre: as linhas já vêm padronizadas em `rendered`
// (largura fixa, valor à direita) pelo model — aqui é só empilhar. Cores fixas
// (preto no branco) porque papel é sempre claro; a largura física em mm vem do
// <style> injetado pela page conforme ?w (80/58mm).
export function ReceiptDocument({ model }: { model: ReceiptModel }) {
  const divider = "-".repeat(model.width);
  return (
    <div className="receipt font-mono whitespace-pre">
      <div className="receipt-center" style={{ fontWeight: 700 }}>{model.header.title}</div>
      {model.header.subtitle && <div className="receipt-center">{model.header.subtitle}</div>}
      <div>{divider}</div>
      <div>{model.header.docNumber}</div>
      {model.header.dateTime && <div>{model.header.dateTime}</div>}
      {model.header.customer && <div>{`Cliente: ${model.header.customer}`}</div>}
      <div>{divider}</div>
      {model.lines.map((l, i) => (
        <div key={i}>{l.rendered}</div>
      ))}
      <div>{divider}</div>
      <div style={{ fontWeight: 700 }}>{model.totals.rendered}</div>
      {model.payment && <div>{model.payment.rendered}</div>}
      <div>{divider}</div>
      {model.footer.map((f, i) => (
        <div key={i} className="receipt-center">{f}</div>
      ))}
    </div>
  );
}
