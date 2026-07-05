import { describe, it, expect } from "vitest";
import { buildKitchenTickets } from "./kitchen";

const order = {
  docNumber: "Comanda #42",
  customerName: "Mesa 3",
  dateTime: "05/07/2026 14:30",
  note: "sem cebola",
  items: [
    { name: "X-Burger", quantity: 2, sector: "cozinha", note: "bem passado" },
    { name: "Batata frita", quantity: 1, sector: "cozinha", note: null },
    { name: "Chopp", quantity: 3, sector: "bar", note: null },
    { name: "Taxa de serviço", quantity: 1, sector: null, note: null }, // não vai p/ produção
  ],
};

describe("buildKitchenTickets", () => {
  it("gera um ticket por setor (ignora itens sem setor)", () => {
    const tickets = buildKitchenTickets(order);
    expect(tickets.map((t) => t.sector).sort()).toEqual(["bar", "cozinha"]);
  });

  it("cada ticket só traz os itens do seu setor, com qtd", () => {
    const tickets = buildKitchenTickets(order);
    const cozinha = tickets.find((t) => t.sector === "cozinha")!;
    expect(cozinha.lines.map((l) => l.name)).toEqual(["X-Burger", "Batata frita"]);
    expect(cozinha.lines.find((l) => l.name === "X-Burger")!.quantity).toBe(2);

    const bar = tickets.find((t) => t.sector === "bar")!;
    expect(bar.lines).toHaveLength(1);
    expect(bar.lines[0].name).toBe("Chopp");
  });

  it("não vaza NENHUM valor/preço (produção não quer valor)", () => {
    const tickets = buildKitchenTickets(order);
    const json = JSON.stringify(tickets);
    expect(json).not.toMatch(/[Cc]ents|preç|price|R\$/);
  });

  it("carrega o cabeçalho da comanda em cada ticket (nº, cliente, obs)", () => {
    const tickets = buildKitchenTickets(order);
    for (const t of tickets) {
      expect(t.header.docNumber).toBe("Comanda #42");
      expect(t.header.customerName).toBe("Mesa 3");
      expect(t.header.note).toBe("sem cebola");
    }
  });

  it("comanda sem itens de produção → nenhum ticket", () => {
    const tickets = buildKitchenTickets({ ...order, items: [{ name: "Só serviço", quantity: 1, sector: null, note: null }] });
    expect(tickets).toEqual([]);
  });
});
