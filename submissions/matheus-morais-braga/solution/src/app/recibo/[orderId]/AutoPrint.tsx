"use client";

import { useEffect } from "react";

// Dispara a impressão sozinho quando a rota é aberta com ?print=1 (é isso que o
// iframe oculto do Caixa faz). O setTimeout dá um respiro pro layout assentar
// antes do diálogo. Em kiosk (chrome --kiosk-printing) imprime sem diálogo.
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 200);
    return () => clearTimeout(t);
  }, []);
  return null;
}
