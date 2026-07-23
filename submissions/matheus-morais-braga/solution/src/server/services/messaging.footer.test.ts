import { describe, it, expect } from "vitest";
import { appendOptOutFooter } from "./messaging";

describe("appendOptOutFooter", () => {
  const FOOTER = "Responda SAIR para não receber mais mensagens.";

  it("anexa o rodapé separado por linha em branco", () => {
    expect(appendOptOutFooter("Olá Ana!", FOOTER)).toBe(`Olá Ana!\n\n${FOOTER}`);
  });

  it("não duplica quando o rodapé já está presente", () => {
    const msg = `Olá Ana!\n\n${FOOTER}`;
    expect(appendOptOutFooter(msg, FOOTER)).toBe(msg);
  });

  it("é no-op quando o texto do rodapé é vazio", () => {
    expect(appendOptOutFooter("Olá Ana!", "   ")).toBe("Olá Ana!");
  });
});
