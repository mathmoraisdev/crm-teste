import { describe, it, expect } from "vitest";
import { shouldTranscribe } from "./transcribe-policy";

describe("shouldTranscribe", () => {
  const cfg = { enabled: true, maxSeconds: 300 };

  it("transcreve áudio curto dentro do teto", () => {
    expect(shouldTranscribe({ seconds: 30 }, cfg)).toBe(true);
  });
  it("não transcreve com a feature desligada", () => {
    expect(shouldTranscribe({ seconds: 30 }, { ...cfg, enabled: false })).toBe(false);
  });
  it("não transcreve áudio acima do teto de duração", () => {
    expect(shouldTranscribe({ seconds: 600 }, cfg)).toBe(false);
  });
  it("transcreve quando a duração é desconhecida (deixa o teto de 25MB decidir)", () => {
    expect(shouldTranscribe({ seconds: undefined }, cfg)).toBe(true);
  });
});
