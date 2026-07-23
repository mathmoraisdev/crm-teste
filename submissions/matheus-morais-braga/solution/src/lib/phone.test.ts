import { describe, it, expect } from "vitest";
import { brPhoneVariants, isBrMobile, maskBrPhone } from "./phone";

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

describe("isBrMobile", () => {
  it("aceita celular BR (mascarado ou cru)", () => {
    expect(isBrMobile("(11) 99999-8888")).toBe(true);
    expect(isBrMobile("11999998888")).toBe(true);
    expect(isBrMobile("+5541999998888")).toBe(true);
  });

  it("rejeita fixo (10 dígitos, sem 9º dígito)", () => {
    expect(isBrMobile("(11) 3333-4444")).toBe(false);
  });

  it("rejeita número fake/incompleto", () => {
    expect(isBrMobile("699999999")).toBe(false); // caso real dos prints
    expect(isBrMobile("6999999999")).toBe(false);
    expect(isBrMobile("abc")).toBe(false);
    expect(isBrMobile("")).toBe(false);
  });

  it("rejeita internacional (não-BR) no link público", () => {
    expect(isBrMobile("+14155552671")).toBe(false);
  });
});

describe("maskBrPhone", () => {
  it("formata progressivamente sem completar o que falta", () => {
    expect(maskBrPhone("11")).toBe("11");
    expect(maskBrPhone("1199")).toBe("(11) 99");
    expect(maskBrPhone("11999998888")).toBe("(11) 99999-8888");
  });

  it("ignora não-dígitos e trava em 11 dígitos", () => {
    expect(maskBrPhone("(11) 99999-8888 99")).toBe("(11) 99999-8888");
  });
});
