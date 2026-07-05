// Impressão do cupom SEM sair do Caixa: um <iframe> oculto carrega
// /recibo/[id]?print=1 e o próprio AutoPrint da rota dispara window.print() no
// contexto do iframe. Removemos o iframe no afterprint (fallback por timeout).
// Serve tanto o fechamento quanto a reimpressão do extrato.
//
// Em kiosk (chrome --kiosk-printing) o print() imprime direto, sem diálogo —
// orientar o cliente no onboarding se quiser eliminar o clique de confirmação.

export type ReceiptWidthMM = 80 | 58;

export function printReceipt(orderId: string, width: ReceiptWidthMM = 80): void {
  if (typeof document === "undefined") return;
  const src = `/recibo/${orderId}?print=1&w=${width}`;

  try {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    Object.assign(iframe.style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      width: "0",
      height: "0",
      border: "0",
      visibility: "hidden",
    } as CSSStyleDeclaration);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      iframe.remove();
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      // AutoPrint (na rota) já chama print(); só precisamos limpar depois.
      if (win) win.addEventListener("afterprint", cleanup, { once: true });
      // Rede de segurança: se afterprint não vier (navegador/plataforma), remove.
      setTimeout(cleanup, 60_000);
    };
    // Se o iframe falhar por completo, abre numa aba como fallback.
    iframe.onerror = () => {
      cleanup();
      window.open(src, "_blank", "noopener");
    };

    iframe.src = src;
    document.body.appendChild(iframe);
  } catch {
    // Ambiente sem suporte a iframe programático: cai no window.open.
    window.open(src, "_blank", "noopener");
  }
}
