import { describe, it, expect } from "vitest";
import { pickSendJid } from "./jid";

describe("pickSendJid", () => {
  const fallback = "5541984180035@s.whatsapp.net"; // montado na mão, COM o 9

  it("usa o JID canônico do onWhatsApp (corrige o 9º dígito BR)", () => {
    // WhatsApp diz que a conta existe, mas registrada SEM o 9.
    const hits = [{ exists: true, jid: "554184180035@s.whatsapp.net" }];
    expect(pickSendJid(fallback, hits)).toEqual({
      exists: true,
      jid: "554184180035@s.whatsapp.net",
    });
  });

  it("mantém o JID quando ele já bate (número moderno com 9)", () => {
    const hits = [{ exists: true, jid: fallback }];
    expect(pickSendJid(fallback, hits)).toEqual({ exists: true, jid: fallback });
  });

  it("cai no fallback quando o hit não traz jid", () => {
    expect(pickSendJid(fallback, [{ exists: true }])).toEqual({
      exists: true,
      jid: fallback,
    });
  });

  it("marca exists=false quando o número não está no WhatsApp", () => {
    expect(pickSendJid(fallback, [{ exists: false }])).toEqual({
      exists: false,
      jid: fallback,
    });
  });

  it("marca exists=false quando a resposta vem vazia", () => {
    expect(pickSendJid(fallback, [])).toEqual({ exists: false, jid: fallback });
    expect(pickSendJid(fallback, undefined)).toEqual({ exists: false, jid: fallback });
  });
});
