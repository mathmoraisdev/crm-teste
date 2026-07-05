// Modelo puro do recibo/cupom. SEM I/O: recebe a comanda + dados da empresa já
// carregados e devolve blocos estruturados (cabeçalho, linhas, totais, pagamento,
// rodapé). É a ÚNICA fonte de verdade da formatação — consumida pelos dois
// renderizadores (HTML/React na N1 e bytes ESC/POS na N2), o que mantém a
// largura de coluna, o alinhamento do valor à direita e a quebra de nome longo
// testáveis num só lugar. `formatCentsBRL` (de @/lib/money) só formata strings.
import { formatCentsBRL } from "@/lib/money";

/** 32 col = bobina 80mm; 24 col = bobina 58mm. */
export type ReceiptWidth = 32 | 24;

export type ReceiptPayment = "DINHEIRO" | "PIX" | "CARTAO" | "OUTRO";

export interface ReceiptBusiness {
  name: string;
  subtitle?: string | null;
  width: ReceiptWidth;
}

export interface ReceiptOrderItem {
  nameSnapshot: string;
  quantity: number;
  unitPriceCents: number;
}

export interface ReceiptOrderInput {
  number: number | null;
  id: string;
  customerName: string | null;
  closedAt: Date | null;
  payment: ReceiptPayment | null;
  items: ReceiptOrderItem[];
}

export interface ReceiptLine {
  name: string; // nome do item (snapshot), sem qtd — p/ localizar/renderizar
  quantity: number;
  totalCents: number; // qtd × preço unitário
  rendered: string; // linha monoespaçada de largura fixa (label + valor à direita)
}

export interface ReceiptModel {
  width: ReceiptWidth;
  header: {
    title: string;
    subtitle: string | null;
    docNumber: string; // "Cupom #42" ou "Comanda <id curto>"
    dateTime: string | null; // dd/MM/yyyy HH:mm (America/Sao_Paulo)
    customer: string | null;
  };
  lines: ReceiptLine[];
  totals: { totalCents: number; rendered: string };
  payment: { method: ReceiptPayment; label: string; rendered: string } | null;
  footer: string[];
}

const PAYMENT_LABEL: Record<ReceiptPayment, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão",
  OUTRO: "Outro",
};

/** Alinha `left` à esquerda e `right` à direita numa linha de exatamente `width`
 * colunas. Se `left` não couber (sobra p/ o valor + 1 espaço), trunca com "…". */
function padRow(left: string, right: string, width: number): string {
  const maxLeft = Math.max(0, width - right.length - 1); // 1 espaço mínimo de folga
  let l = left;
  if (l.length > maxLeft) l = maxLeft > 0 ? l.slice(0, maxLeft - 1) + "…" : "";
  const gap = Math.max(1, width - l.length - right.length);
  return l + " ".repeat(gap) + right;
}

/** dd/MM/yyyy HH:mm no fuso de São Paulo (produto BR). Determinístico. */
export function formatReceiptDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** Traduz uma comanda (já carregada) no modelo de recibo estruturado. Puro. */
export function buildReceiptModel(order: ReceiptOrderInput, business: ReceiptBusiness): ReceiptModel {
  const width = business.width;

  const docNumber =
    order.number != null ? `Cupom #${order.number}` : `Comanda ${order.id}`.slice(0, 20);

  const lines: ReceiptLine[] = order.items.map((it) => {
    const qty = Math.max(1, Math.floor(it.quantity));
    const totalCents = it.unitPriceCents * qty;
    const label = qty > 1 ? `${qty}x ${it.nameSnapshot}` : it.nameSnapshot;
    return {
      name: it.nameSnapshot,
      quantity: qty,
      totalCents,
      rendered: padRow(label, formatCentsBRL(totalCents), width),
    };
  });

  const totalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);

  const payment: ReceiptModel["payment"] = order.payment
    ? {
        method: order.payment,
        label: PAYMENT_LABEL[order.payment],
        rendered: padRow("Pagamento", PAYMENT_LABEL[order.payment], width),
      }
    : null;

  return {
    width,
    header: {
      title: business.name,
      subtitle: business.subtitle?.trim() || null,
      docNumber,
      dateTime: order.closedAt ? formatReceiptDateTime(order.closedAt) : null,
      customer: order.customerName?.trim() || null,
    },
    lines,
    totals: { totalCents, rendered: padRow("TOTAL", formatCentsBRL(totalCents), width) },
    payment,
    footer: ["Obrigado pela preferência!"],
  };
}
