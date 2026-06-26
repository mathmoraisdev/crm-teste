import { describe, it, expect } from "vitest";
import { isMediaMessage, MEDIA_KEYS } from "./media";

describe("isMediaMessage", () => {
  it("detecta cada tipo de mídia conhecido", () => {
    for (const k of MEDIA_KEYS) {
      expect(isMediaMessage({ [k]: {} })).toBe(true);
    }
  });

  it("texto puro NÃO é mídia", () => {
    expect(isMediaMessage({ conversation: "oi" })).toBe(false);
    expect(isMediaMessage({ extendedTextMessage: { text: "oi" } })).toBe(false);
  });

  it("nulo/indefinido/não-objeto → false (não dispara aviso)", () => {
    expect(isMediaMessage(null)).toBe(false);
    expect(isMediaMessage(undefined)).toBe(false);
    expect(isMediaMessage("audioMessage")).toBe(false); // string com o nome ≠ objeto
    expect(isMediaMessage({})).toBe(false);
  });

  it("mídia com legenda de texto ainda conta como mídia", () => {
    // doc-com-legenda já vem desaninhado pelo handler; aqui só importa ter a chave.
    expect(isMediaMessage({ imageMessage: { caption: "olha isso" } })).toBe(true);
  });
});
