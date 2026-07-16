import { describe, it, expect } from "vitest";
import { isMediaMessage, mediaPlaceholder, downloadableMedia, MEDIA_KEYS } from "./media";

describe("isMediaMessage", () => {
  it("detecta cada tipo de mídia conhecido", () => {
    for (const k of MEDIA_KEYS) {
      expect(isMediaMessage({ [k]: {} })).toBe(true);
    }
  });

  it("texto puro NÃO é mídia", () => {
    expect(isMediaMessage({ conversation: "oi" })).toBe(false);
    expect(isMediaMessage({ extendedTextMessage: { text: "oi" } })).toBe(false);
  });

  it("nulo/indefinido/não-objeto → false (não dispara aviso)", () => {
    expect(isMediaMessage(null)).toBe(false);
    expect(isMediaMessage(undefined)).toBe(false);
    expect(isMediaMessage("audioMessage")).toBe(false); // string com o nome ≠ objeto
    expect(isMediaMessage({})).toBe(false);
  });

  it("mídia com legenda de texto ainda conta como mídia", () => {
    // doc-com-legenda já vem desaninhado pelo handler; aqui só importa ter a chave.
    expect(isMediaMessage({ imageMessage: { caption: "olha isso" } })).toBe(true);
  });

  it("chave de mídia presente com valor nulo NÃO conta (regressão do 'in')", () => {
    // Objetos do Baileys podem trazer chaves de oneof presentes porém nulas.
    expect(isMediaMessage({ imageMessage: null, conversation: "oi" })).toBe(false);
  });
});

describe("mediaPlaceholder", () => {
  it("áudio é rotulado como Áudio, não Imagem", () => {
    expect(mediaPlaceholder({ audioMessage: { mimetype: "audio/ogg" } })).toBe("🎤 Áudio");
  });

  it("imageMessage nula não rouba o rótulo de um áudio real (bug do áudio→imagem)", () => {
    // Reproduz o caso reportado: chave imageMessage presente porém nula + áudio real.
    expect(
      mediaPlaceholder({ imageMessage: null, audioMessage: { mimetype: "audio/ogg; codecs=opus" } }),
    ).toBe("🎤 Áudio");
  });

  it("imagem real → Imagem", () => {
    expect(mediaPlaceholder({ imageMessage: { mimetype: "image/jpeg" } })).toBe("📷 Imagem");
  });
});

describe("downloadableMedia", () => {
  it("áudio é baixável com mediaType audio e extensão derivada do mime", () => {
    const dl = downloadableMedia({ audioMessage: { mimetype: "audio/ogg; codecs=opus" } });
    expect(dl?.mediaType).toBe("audio");
    expect(dl?.ext).toBe("ogg");
    expect(dl?.fileName).toBe("audio.ogg");
  });

  it("imageMessage nula não classifica um áudio como imagem", () => {
    const dl = downloadableMedia({ imageMessage: null, audioMessage: { mimetype: "audio/mpeg" } });
    expect(dl?.mediaType).toBe("audio");
  });
});
