import { describe, it, expect } from "vitest";
import { isOptOut } from "./optout";

describe("isOptOut", () => {
  it("detecta palavras-chave isoladas, sem acento e case-insensitive", () => {
    for (const t of ["PARAR", "parar", "Sair", "stop", "cancelar", "descadastrar", "remover"]) {
      expect(isOptOut(t)).toBe(true);
    }
  });

  it("detecta palavra-chave dentro de uma frase curta", () => {
    expect(isOptOut("quero parar de receber")).toBe(true);
    expect(isOptOut("PARE de me mandar mensagem")).toBe(true);
    expect(isOptOut("não quero mais")).toBe(true);
  });

  it("não confunde mensagens normais com opt-out", () => {
    expect(isOptOut("olá, quero saber mais")).toBe(false);
    expect(isOptOut("pode me ligar amanhã?")).toBe(false);
    expect(isOptOut("comparar os planos")).toBe(false); // contém "parar" como substring → NÃO é opt-out
  });
});
