// Comanda de cozinha / produção (N3): agrupa os itens de uma comanda por SETOR
// (cozinha/bar/balcão) e gera um ticket por setor — SEM valores (produção não quer
// preço; quer qtd, nome e observação). Pura, sem I/O: o setor de cada item (vindo
// do CatalogItem.printSector) é resolvido pelo loader e chega aqui já anotado.
// Consumida por um renderizador (HTML na N1: um iframe por setor; ESC/POS na N2:
// um job por impressora de setor).

export interface KitchenItemInput {
  name: string;
  quantity: number;
  sector: string | null; // null = item não roteado p/ produção (ex.: taxa, serviço)
  note?: string | null; // observação do item (ex.: "sem cebola")
  modifiers?: string[]; // adicionais/variações (só nomes; produção não vê valor)
}

export interface KitchenOrderInput {
  docNumber: string; // mesmo identificador do recibo ("Comanda #42" / id curto)
  customerName: string | null;
  dateTime: string | null;
  note: string | null; // observação da comanda inteira
  items: KitchenItemInput[];
}

export interface KitchenTicketLine {
  name: string;
  quantity: number;
  note?: string | null;
  modifiers?: string[]; // adicionais do item (só nomes)
}

export interface KitchenTicket {
  sector: string;
  // cabeçalho repetido em cada ticket p/ o setor ser autossuficiente na impressão
  header: { docNumber: string; customerName: string | null; dateTime: string | null; note: string | null };
  lines: KitchenTicketLine[];
}

/** Um ticket por setor com itens desse setor. Itens sem setor são ignorados.
 * Setores ordenados alfabeticamente (determinístico). */
export function buildKitchenTickets(order: KitchenOrderInput): KitchenTicket[] {
  const bySector = new Map<string, KitchenTicketLine[]>();
  for (const it of order.items) {
    if (!it.sector) continue; // não vai p/ produção
    const lines = bySector.get(it.sector) ?? [];
    lines.push({
      name: it.name,
      quantity: Math.max(1, Math.floor(it.quantity)),
      note: it.note ?? null,
      ...(it.modifiers && it.modifiers.length ? { modifiers: it.modifiers } : {}),
    });
    bySector.set(it.sector, lines);
  }

  const header = {
    docNumber: order.docNumber,
    customerName: order.customerName,
    dateTime: order.dateTime,
    note: order.note,
  };

  return [...bySector.keys()]
    .sort()
    .map((sector) => ({ sector, header, lines: bySector.get(sector)! }));
}
