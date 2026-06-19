import { describe, it, expect } from "vitest";
import { brPhoneVariants } from "./phone";

describe("brPhoneVariants", () => {
  it("celular BR salvo COM o 9 também casa SEM o 9 (JID canônico)", () => {
    // caso real: lead salvo +5569993068151, inbound chega de +556993068151
    expect(brPhoneVariants("+5569993068151")).toEqual([
      "+5569993068151",
      "+556993068151",
    ]);
  });

  it("celular BR vindo SEM o 9 também casa COM o 9", () => {
    expect(brPhoneVariants("+556993068151")).toEqual([
      "+556993068151",
      "+5569993068151",
    ]);
  });

  it("sempre devolve a original primeiro", () => {
    expect(brPhoneVariants("+5511988881111")[0]).toBe("+5511988881111");
  });

  it("não inventa variante para número não-BR", () => {
    expect(brPhoneVariants("+14155552671")).toEqual(["+14155552671"]);
  });

  it("não duplica quando não há transformação aplicável", () => {
    // local com 9 dígitos que não começa com 9 → sem variante de remoção
    const r = brPhoneVariants("+5511788881111");
    expect(r).toEqual(["+5511788881111"]);
  });
});
