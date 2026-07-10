import { describe, it, expect } from "vitest";
import { buildReceiptModel } from "./model";
import { buildEscposBytes, ESC, GS } from "./escpos";

const business = { name: "Barbearia Style", subtitle: "Seg–Sáb 9h–20h", width: 32 as const };
const order = {
  number: 42,
  id: "ckxyz123",
  customerName: "João",
  closedAt: new Date("2026-07-05T14:30:00-03:00"),
  payment: "DINHEIRO" as const,
  items: [
    { nameSnapshot: "Corte masculino", quantity: 1, unitPriceCents: 4000 },
    { nameSnapshot: "Barba", quantity: 2, unitPriceCents: 2500 },
  ],
};

/** Acha a posição de uma subsequência de bytes (ou -1). */
function indexOfSeq(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
const has = (h: Uint8Array, n: number[]) => indexOfSeq(h, n) !== -1;

describe("buildEscposBytes", () => {
  const model = buildReceiptModel(order, business);

  it("começa com o init ESC @", () => {
    const bytes = buildEscposBytes(model);
    expect(bytes[0]).toBe(ESC);
    expect(bytes[1]).toBe(0x40);
  });

  it("emite negrito (ESC E 1) no título e volta (ESC E 0)", () => {
    const bytes = buildEscposBytes(model);
    expect(has(bytes, [ESC, 0x45, 0x01])).toBe(true);
    expect(has(bytes, [ESC, 0x45, 0x00])).toBe(true);
  });

  it("contém o texto do cupom (nº e total)", () => {
    const bytes = buildEscposBytes(model);
    const ascii = Array.from(bytes).map((b) => String.fromCharCode(b)).join("");
    expect(ascii).toContain("Cupom #42");
    expect(ascii).toContain("TOTAL");
  });

  it("imprime as sub-linhas de adicionais sob o item", () => {
    const m = buildReceiptModel(
      { ...order, items: [
        { nameSnapshot: "X-Burger", quantity: 1, unitPriceCents: 3300, modifiers: [{ optionName: "Grande" }, { optionName: "Bacon" }] },
      ] },
      business,
    );
    const bytes = buildEscposBytes(m);
    const ascii = Array.from(bytes).map((b) => String.fromCharCode(b)).join("");
    expect(ascii).toContain("Grande");
    expect(ascii).toContain("Bacon");
  });

  it("corta o papel (GS V) ao final", () => {
    const bytes = buildEscposBytes(model);
    expect(has(bytes, [GS, 0x56])).toBe(true);
  });

  it("NÃO abre a gaveta por padrão", () => {
    const bytes = buildEscposBytes(model);
    expect(has(bytes, [ESC, 0x70])).toBe(false);
  });

  it("abre a gaveta (pulso ESC p) quando openDrawer=true", () => {
    const bytes = buildEscposBytes(model, { openDrawer: true });
    expect(has(bytes, [ESC, 0x70, 0x00])).toBe(true);
  });
});
