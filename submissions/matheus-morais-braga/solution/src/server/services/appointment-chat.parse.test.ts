import { describe, it, expect } from "vitest";
import { parsePreferredStart } from "./appointment-chat.service";

// `parsePreferredStart` converte o ISO "de parede" (naive, sem offset) que a IA
// devolve como preferência do lead para o instante UTC no fuso da conta.
// America/Sao_Paulo = UTC-3 (sem DST desde 2019).
const TZ = "America/Sao_Paulo";

describe("parsePreferredStart", () => {
  it("interpreta a hora como parede local e converte p/ UTC (14h BRT = 17h UTC)", () => {
    const d = parsePreferredStart("2026-07-15T14:00:00", TZ);
    expect(d?.toISOString()).toBe("2026-07-15T17:00:00.000Z");
  });

  it("aceita data sem hora → 00:00 local (03:00 UTC)", () => {
    const d = parsePreferredStart("2026-07-16", TZ);
    expect(d?.toISOString()).toBe("2026-07-16T03:00:00.000Z");
  });

  it("tolera espaço em vez de 'T' e minutos", () => {
    const d = parsePreferredStart("2026-07-15 09:30", TZ);
    expect(d?.toISOString()).toBe("2026-07-15T12:30:00.000Z");
  });

  it("retorna null para lixo", () => {
    expect(parsePreferredStart("semana que vem", TZ)).toBeNull();
    expect(parsePreferredStart("", TZ)).toBeNull();
  });
});
