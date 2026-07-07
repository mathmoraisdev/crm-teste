import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpHint } from "./HelpHint";

describe("HelpHint", () => {
  it("renderiza o texto de ajuda e um gatilho acessível", () => {
    const html = renderToStaticMarkup(<HelpHint label="Por que isso importa">A IA usa este texto.</HelpHint>);
    expect(html).toContain("A IA usa este texto.");
    expect(html).toContain("Por que isso importa"); // aria-label no gatilho
  });
});
