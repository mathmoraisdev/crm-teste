import type { Tone } from "@/components/ui/Badge";

export type Payment = "DINHEIRO" | "PIX" | "CARTAO" | "OUTRO";

export const PAYMENT_LABEL: Record<Payment, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão",
  OUTRO: "Outro",
};

/** Cor do Badge por forma de pagamento (usado no extrato). */
export const PAYMENT_TONE: Record<Payment, Tone> = {
  DINHEIRO: "green",
  PIX: "blue",
  CARTAO: "violet",
  OUTRO: "slate",
};
