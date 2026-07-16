import type { Metadata } from "next";

// Rota standalone das comandas de cozinha (N3), fora do grupo (app) — sem Sidebar.
// Cada setor vira um bloco com quebra de página, p/ a impressora cortar entre eles.
// Papel sempre claro: fundo branco/texto preto fixos.
export const metadata: Metadata = { title: "Produção" };

const CSS = `
  .producao-screen { display:flex; flex-direction:column; align-items:center; gap:16px; padding:24px; background:#f1f5f9; min-height:100vh; }
  .kticket { background:#fff; color:#000; padding:12px; line-height:1.4; font-size:14px; width:32ch;
             box-shadow:0 1px 4px rgba(0,0,0,.15); }
  .kticket-center { text-align:center; }
  @media print {
    html, body { background:#fff !important; }
    .producao-screen { background:#fff !important; padding:0; gap:0; display:block; min-height:0; }
    .kticket { box-shadow:none; padding:2mm; width:80mm; break-after:page; page-break-after:always; }
    @page { size: 80mm auto; margin: 0; }
  }
`;

export default function ProducaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="producao-screen">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {children}
    </div>
  );
}
