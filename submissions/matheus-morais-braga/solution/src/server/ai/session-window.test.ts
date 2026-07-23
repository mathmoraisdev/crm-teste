import { describe, it, expect } from "vitest";
import { sessionWindow } from "./transcript";

// helper: turno num instante (minutos a partir de uma base fixa)
const base = new Date("2026-06-26T12:00:00.000Z").getTime();
const at = (min: number, content = "x") => ({
  direction: "INBOUND" as const,
  content,
  createdAt: new Date(base + min * 60_000),
});

describe("sessionWindow", () => {
  it("mantém tudo quando não há gap maior que o limite", () => {
    const turns = [at(0), at(10), at(20)]; // gaps de 10 min
    expect(sessionWindow(turns, 180)).toHaveLength(3);
  });

  it("corta no gap > limite: volta no dia seguinte → só a sessão nova", () => {
    const turns = [
      at(0, "dúvida de ontem"),
      at(5, "resposta de ontem"),
      at(24 * 60, "oi, outra dúvida hoje"), // 24h depois
      at(24 * 60 + 2, "detalhe"),
    ];
    const out = sessionWindow(turns, 180);
    expect(out.map((t) => t.content)).toEqual(["oi, outra dúvida hoje", "detalhe"]);
  });

  it("mantém pausa curta dentro do limite (cliente pensando no meio da conversa)", () => {
    const turns = [at(0), at(30), at(120)]; // maior gap = 90 min < 180
    expect(sessionWindow(turns, 180)).toHaveLength(3);
  });

  it("corta apenas no gap mais recente quando há vários", () => {
    const turns = [at(0), at(10), at(500), at(510), at(1000), at(1005)];
    // gaps: 10, 490, 10, 490, 5 → o último gap > 180 é entre 510 e 1000
    const out = sessionWindow(turns, 180);
    expect(out.map((t) => t.createdAt.getTime() - base).map((ms) => ms / 60_000)).toEqual([
      1000, 1005,
    ]);
  });

  it("resetMinutes <= 0 desliga o corte (mantém tudo)", () => {
    const turns = [at(0), at(24 * 60)];
    expect(sessionWindow(turns, 0)).toHaveLength(2);
  });

  it("0 ou 1 turno passa direto", () => {
    expect(sessionWindow([], 180)).toHaveLength(0);
    expect(sessionWindow([at(0)], 180)).toHaveLength(1);
  });
});
