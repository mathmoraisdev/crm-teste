import { describe, it, expect } from "vitest";
import { resolvePeriod, competenceMonth, dueDateForDayOfMonth } from "./date-range";

// Fixa um instante conhecido: 2026-07-03 15:00 UTC = 12:00 em America/Sao_Paulo (UTC-3).
const NOW = new Date("2026-07-03T15:00:00.000Z");

describe("resolvePeriod (America/Sao_Paulo, sem DST)", () => {
  it("hoje começa à meia-noite local (03:00 UTC) do dia corrente", () => {
    const { from, to } = resolvePeriod("hoje", NOW);
    expect(from.toISOString()).toBe("2026-07-03T03:00:00.000Z");
    expect(to).toBe(NOW);
  });

  it("7d cobre 7 dias de calendário (início 6 dias atrás)", () => {
    const { from } = resolvePeriod("7d", NOW);
    expect(from.toISOString()).toBe("2026-06-27T03:00:00.000Z");
  });

  it("mes começa no dia 1 do mês local", () => {
    const { from } = resolvePeriod("mes", NOW);
    expect(from.toISOString()).toBe("2026-07-01T03:00:00.000Z");
  });
});

describe("competenceMonth", () => {
  it("rotula o mês local como YYYY-MM", () => {
    // 2026-07-04 12:00 BRT
    expect(competenceMonth(new Date("2026-07-04T15:00:00Z"))).toBe("2026-07");
  });
});

describe("dueDateForDayOfMonth", () => {
  it("usa o dia pedido dentro do mês", () => {
    const d = dueDateForDayOfMonth("2026-07", 5);
    // 2026-07-05 no fuso local
    expect(d.toISOString().slice(0, 10)).toBe("2026-07-05");
  });
  it("clampa ao último dia em mês curto (fev, dia 31)", () => {
    const d = dueDateForDayOfMonth("2026-02", 31);
    expect(d.toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});
