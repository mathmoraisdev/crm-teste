"use client";

import { useEffect } from "react";

// Dispara a impressão sozinho quando aberto com ?print=1 (o iframe do Caixa faz isso).
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 200);
    return () => clearTimeout(t);
  }, []);
  return null;
}
