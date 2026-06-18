import { describe, it, expect } from "vitest";
import { renderSpintax } from "./spintax";

describe("renderSpintax", () => {
  // pick determinístico: sempre a 1ª opção
  const first = (n: number) => 0;
  const last = (n: number) => n - 1;

  it("escolhe a opção indicada por `pick` em cada grupo", () => {
    expect(renderSpintax("{oi|olá|e aí} tudo bem?", first)).toBe("oi tudo bem?");
    expect(renderSpintax("{oi|olá|e aí} tudo bem?", last)).toBe("e aí tudo bem?");
  });

  it("resolve múltiplos grupos e mantém o texto fora deles", () => {
    expect(renderSpintax("{bom dia|olá} {nome}, {pode falar|tem um minuto}?", first))
      .toBe("bom dia {nome}, pode falar?");
  });

  it("texto sem spintax volta inalterado", () => {
    expect(renderSpintax("mensagem simples", first)).toBe("mensagem simples");
  });
});
