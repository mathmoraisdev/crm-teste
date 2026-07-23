import { describe, it, expect } from "vitest";
import { renderSnippet } from "./render-snippet";

describe("renderSnippet", () => {
  it("substitui {{nome}} pelo valor", () => {
    expect(renderSnippet("Olá {{nome}}, tudo bem?", { nome: "Ana" })).toBe("Olá Ana, tudo bem?");
  });

  it("aceita espaços dentro das chaves", () => {
    expect(renderSnippet("Oi {{ nome }}", { nome: "Bia" })).toBe("Oi Bia");
  });

  it("nome ausente vira vazio (não deixa {{nome}} cru)", () => {
    expect(renderSnippet("Olá {{nome}}!", {})).toBe("Olá !");
    expect(renderSnippet("Olá {{nome}}!", { nome: null })).toBe("Olá !");
  });

  it("placeholder desconhecido é removido (não vaza)", () => {
    expect(renderSnippet("Valor: {{preco}} fim", { nome: "Ana" })).toBe("Valor:  fim");
  });

  it("substitui múltiplas ocorrências", () => {
    expect(renderSnippet("{{nome}} {{nome}}", { nome: "Zé" })).toBe("Zé Zé");
  });

  it("texto sem placeholder passa intacto", () => {
    expect(renderSnippet("Sem variáveis aqui")).toBe("Sem variáveis aqui");
  });
});
