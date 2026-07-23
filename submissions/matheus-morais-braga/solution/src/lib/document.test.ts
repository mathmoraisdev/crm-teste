import { describe, it, expect } from "vitest";
import { normalizeDocument } from "./document";

describe("normalizeDocument", () => {
  it("tira máscara do CPF", () => expect(normalizeDocument("123.456.789-09", "PF")).toBe("12345678909"));
  it("tira máscara do CNPJ", () => expect(normalizeDocument("12.345.678/0001-95", "PJ")).toBe("12345678000195"));
  it("vazio vira null", () => expect(normalizeDocument("", "PF")).toBeNull());
  it("comprimento errado lança", () => expect(() => normalizeDocument("123", "PF")).toThrow());
});
