import type { KitchenTicket } from "@/lib/receipt/kitchen";

// Renderizador HTML (N1) de um ticket de cozinha. Monoespaçado, SEM valores.
// O setor vem em destaque; cada item em qtd × nome + observação.
export function KitchenTicketDocument({ ticket }: { ticket: KitchenTicket }) {
  const divider = "-".repeat(32);
  return (
    <div className="kticket font-mono whitespace-pre">
      <div className="kticket-center" style={{ fontWeight: 800, fontSize: "1.4em", textTransform: "uppercase" }}>
        {ticket.sector}
      </div>
      <div>{divider}</div>
      <div>{ticket.header.docNumber}</div>
      {ticket.header.customerName && <div>{ticket.header.customerName}</div>}
      {ticket.header.dateTime && <div>{ticket.header.dateTime}</div>}
      <div>{divider}</div>
      {ticket.lines.map((l, i) => (
        <div key={i}>
          <div style={{ fontWeight: 700 }}>{`${l.quantity}x ${l.name}`}</div>
          {(l.modifiers ?? []).map((m, k) => (
            <div key={k}>{`   + ${m}`}</div>
          ))}
          {l.note && <div>{`   * ${l.note}`}</div>}
        </div>
      ))}
      {ticket.header.note && (
        <>
          <div>{divider}</div>
          <div>{`Obs: ${ticket.header.note}`}</div>
        </>
      )}
    </div>
  );
}
