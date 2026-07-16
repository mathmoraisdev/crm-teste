import { describe, it, expect } from "vitest";
import { formatTranscript } from "./transcript";

describe("formatTranscript", () => {
  it("rotula INBOUND como Lead e OUTBOUND como Vendedor", () => {
    const out = formatTranscript([
      { direction: "OUTBOUND", content: "Oi João, tudo bem?" },
      { direction: "INBOUND", content: "Tudo, e você?" },
    ]);
    expect(out).toBe("Vendedor: Oi João, tudo bem?\nLead: Tudo, e você?");
  });

  it("uma linha por turno, na ordem recebida", () => {
    const out = formatTranscript([
      { direction: "INBOUND", content: "a" },
      { direction: "INBOUND", content: "b" },
    ]);
    expect(out.split("\n")).toHaveLength(2);
  });

  it("conversa vazia → string vazia", () => {
    expect(formatTranscript([])).toBe("");
  });
});
