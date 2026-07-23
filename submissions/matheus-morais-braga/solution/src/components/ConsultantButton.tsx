"use client";

import { Button } from "@/components/ui/Button";
import { ConsultantModal } from "@/components/ConsultantModal";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Botão reutilizável que abre o funil "fale com nosso consultor". Importado pela
 * landing (e onde mais precisar). Propaga o `plan` de interesse para a mensagem
 * pré-preenchida do WhatsApp.
 */
export function ConsultantButton({
  children,
  plan,
  variant = "primary",
}: {
  children: React.ReactNode;
  plan?: string;
  variant?: Variant;
}) {
  return (
    <ConsultantModal plan={plan} trigger={<Button variant={variant}>{children}</Button>} />
  );
}
