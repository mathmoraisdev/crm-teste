// src/lib/money.test.ts
import { describe, it, expect } from "vitest";
import { parseBRLToCents, formatCentsBRL } from "./money";

describe("parseBRLToCents", () => {
  it("aceita '129,90' -> 12990", () => expect(parseBRLToCents("129,90")).toBe(12990));
  it("aceita '1.299,90' -> 129990 (separador de milhar)", () => expect(parseBRLToCents("1.299,90")).toBe(129990));
  it("aceita '129.90' (ponto decimal) -> 12990", () => expect(parseBRLToCents("129.90")).toBe(12990));
  it("aceita inteiro '150' -> 15000", () => expect(parseBRLToCents("150")).toBe(15000));
  it("ignora 'R$' e espaços", () => expect(parseBRLToCents(" R$ 99,00 ")).toBe(9900));
  it("vazio -> null", () => expect(parseBRLToCents("")).toBe(null));
  it("lixo -> null", () => expect(parseBRLToCents("abc")).toBe(null));
  it("negativo -> null (não aceitamos no lançamento)", () => expect(parseBRLToCents("-10")).toBe(null));
});

describe("formatCentsBRL", () => {
  it("12990 -> 'R$ 129,90'", () => expect(formatCentsBRL(12990)).toBe("R$ 129,90"));
  it("0 -> 'R$ 0,00'", () => expect(formatCentsBRL(0)).toBe("R$ 0,00"));
});
