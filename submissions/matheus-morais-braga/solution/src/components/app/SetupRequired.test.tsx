import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupRequired } from "./SetupRequired";

describe("SetupRequired", () => {
  it("mostra título, descrição e CTA quando canSettings", () => {
    const html = renderToStaticMarkup(
      <SetupRequired
        title="Conecte um número"
        description="Precisa de um chip pareado."
        href="/empresas"
        cta="Conectar"
        canSettings
      />,
    );
    expect(html).toContain("Conecte um número");
    expect(html).toContain("/empresas");
    expect(html).toContain("Conectar");
  });

  it("sem canSettings esconde o CTA e mostra aviso passivo", () => {
    const html = renderToStaticMarkup(
      <SetupRequired
        title="Conecte um número"
        description="Precisa de um chip pareado."
        href="/empresas"
        cta="Conectar"
        canSettings={false}
      />,
    );
    expect(html).not.toContain("/empresas");
    expect(html).toContain("administrador"); // texto passivo
  });
});
