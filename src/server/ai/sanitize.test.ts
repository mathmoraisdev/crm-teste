import { describe, expect, it } from "vitest";
import { stripMarkdownLinks } from "./sanitize";

describe("stripMarkdownLinks", () => {
  it("colapsa [url](url) numa única URL (o bug do link duplicado)", () => {
    const input =
      "Acesse: [https://www.1ripvh.com.br/index.html](https://www.1ripvh.com.br/index.html)";
    expect(stripMarkdownLinks(input)).toBe(
      "Acesse: https://www.1ripvh.com.br/index.html",
    );
  });

  it("tolera diferença de barra final entre texto e destino", () => {
    const input = "[https://site.com.br](https://site.com.br/)";
    expect(stripMarkdownLinks(input)).toBe("https://site.com.br/");
  });

  it("mantém o rótulo quando ele é distinto da URL", () => {
    const input = "Veja [nosso site](https://site.com.br/precos).";
    expect(stripMarkdownLinks(input)).toBe(
      "Veja nosso site (https://site.com.br/precos).",
    );
  });

  it("colapsa rótulo vazio para a URL", () => {
    expect(stripMarkdownLinks("[](https://site.com.br)")).toBe(
      "https://site.com.br",
    );
  });

  it("trata múltiplos links na mesma mensagem", () => {
    const input =
      "[https://a.com](https://a.com) e [b](https://b.com/x)";
    expect(stripMarkdownLinks(input)).toBe(
      "https://a.com e b (https://b.com/x)",
    );
  });

  it("não toca em URL crua nem em texto sem markdown", () => {
    const input = "Fale comigo: https://site.com.br ok?";
    expect(stripMarkdownLinks(input)).toBe(input);
  });

  it("não confunde colchetes que não formam link", () => {
    const input = "[importante] confira a agenda";
    expect(stripMarkdownLinks(input)).toBe(input);
  });
});
