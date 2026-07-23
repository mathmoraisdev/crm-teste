import { describe, it, expect } from "vitest";
import { shouldCreateContact } from "./inbound-resolve";

describe("shouldCreateContact", () => {
  it("cria quando há número da empresa + telefone e nenhum lead casou", () => {
    expect(shouldCreateContact({ matched: false, whatsAppNumberId: "n1", phone: "+5511999" }))
      .toBe(true);
  });
  it("não cria se já casou um lead", () => {
    expect(shouldCreateContact({ matched: true, whatsAppNumberId: "n1", phone: "+5511999" }))
      .toBe(false);
  });
  it("não cria sem número da empresa (ex.: cloud-api sem mapa)", () => {
    expect(shouldCreateContact({ matched: false, whatsAppNumberId: undefined, phone: "+5511999" }))
      .toBe(false);
  });
  it("não cria sem telefone", () => {
    expect(shouldCreateContact({ matched: false, whatsAppNumberId: "n1", phone: undefined }))
      .toBe(false);
  });
});
