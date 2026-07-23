import { describe, it, expect } from "vitest";
import { nextFiscalAction } from "./fiscal-emission";

const MAX = 5;

describe("nextFiscalAction", () => {
  it("PENDENTE → EMITIR", () => {
    expect(nextFiscalAction({ status: "PENDENTE", attempts: 0 }, MAX)).toBe("EMITIR");
  });
  it("PROCESSANDO → CONSULTAR (aguarda SEFAZ)", () => {
    expect(nextFiscalAction({ status: "PROCESSANDO", attempts: 1 }, MAX)).toBe("CONSULTAR");
  });
  it("ERRO abaixo do limite → EMITIR (retry); no limite → DESISTIR", () => {
    expect(nextFiscalAction({ status: "ERRO", attempts: 2 }, MAX)).toBe("EMITIR");
    expect(nextFiscalAction({ status: "ERRO", attempts: MAX }, MAX)).toBe("DESISTIR");
  });
  it("EMITIDA/CANCELADA → NADA (terminal)", () => {
    expect(nextFiscalAction({ status: "EMITIDA", attempts: 1 }, MAX)).toBe("NADA");
    expect(nextFiscalAction({ status: "CANCELADA", attempts: 1 }, MAX)).toBe("NADA");
  });
});
