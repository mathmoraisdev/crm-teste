import type { Metadata } from "next";

// Rota FORA do grupo (app): não herda a Sidebar — é a "folha" standalone que o
// iframe de impressão carrega. O papel é SEMPRE claro, então o recibo força
// fundo branco/texto preto independentemente do tema ([[design-tokens-dark-theme]]).
export const metadata: Metadata = { title: "Recibo" };

const CSS = `
  .recibo-screen { display:flex; justify-content:center; padding:24px; background:#f1f5f9; min-height:100vh; }
  .receipt { background:#fff; color:#000; padding:12px; line-height:1.35; font-size:13px;
             box-shadow:0 1px 4px rgba(0,0,0,.15); }
  .receipt-center { text-align:center; }
  @media print {
    html, body { background:#fff !important; }
    .recibo-screen { background:#fff !important; padding:0; display:block; min-height:0; }
    .receipt { box-shadow:none; padding:2mm; }
  }
`;

export default function ReciboLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="recibo-screen">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {children}
    </div>
  );
}
