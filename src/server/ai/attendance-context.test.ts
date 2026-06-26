import { describe, it, expect } from "vitest";
import { buildAttendanceContext } from "./attendance-context";

describe("buildAttendanceContext", () => {
  it("inclui persona, base e horário quando presentes", () => {
    const out = buildAttendanceContext({
      displayName: "Acme",
      persona: "descontraído",
      knowledgeBase: "Vendemos guarda-chuvas. Frete grátis acima de R$100.",
      businessHours: "Seg–Sex 9h–18h",
    });
    expect(out).toContain("Acme");
    expect(out).toContain("descontraído");
    expect(out).toContain("guarda-chuvas");
    expect(out).toContain("Seg–Sex 9h–18h");
  });

  it("omite seções ausentes sem quebrar", () => {
    const out = buildAttendanceContext({ displayName: null, persona: null, knowledgeBase: null, businessHours: null });
    expect(out).not.toContain("Persona:");
    expect(out).not.toContain("Horário");
    expect(typeof out).toBe("string");
  });
});
