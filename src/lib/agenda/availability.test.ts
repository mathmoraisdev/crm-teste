// src/lib/agenda/availability.test.ts
import { describe, it, expect } from "vitest";
import {
  appointmentEnd,
  overlaps,
  isWithinWorkingHours,
  localWeekdayAndMinutes,
  type DayWindow,
} from "./availability";

describe("appointmentEnd", () => {
  const start = new Date("2026-07-06T13:00:00.000Z");

  it("soma a duração em minutos ao início", () => {
    expect(appointmentEnd(start, 30)).toEqual(
      new Date("2026-07-06T13:30:00.000Z"),
    );
    expect(appointmentEnd(start, 90)).toEqual(
      new Date("2026-07-06T14:30:00.000Z"),
    );
  });

  it("sem duração (null/undefined) retorna instante igual ao início", () => {
    expect(appointmentEnd(start, null).getTime()).toBe(start.getTime());
    expect(appointmentEnd(start, undefined).getTime()).toBe(start.getTime());
  });

  it("duração zero ou negativa retorna instante igual ao início", () => {
    expect(appointmentEnd(start, 0).getTime()).toBe(start.getTime());
    expect(appointmentEnd(start, -15).getTime()).toBe(start.getTime());
  });

  it("retorna uma nova instância de Date (não muta o início)", () => {
    const end = appointmentEnd(start, 0);
    expect(end).not.toBe(start);
    expect(start.getTime()).toBe(new Date("2026-07-06T13:00:00.000Z").getTime());
  });
});

describe("overlaps", () => {
  const t = (h: number, m = 0) =>
    new Date(Date.UTC(2026, 6, 6, h, m, 0));

  it("intervalos que se cruzam parcialmente => true", () => {
    // [10:00,11:00) x [10:30,11:30)
    expect(overlaps(t(10), t(11), t(10, 30), t(11, 30))).toBe(true);
  });

  it("contenção total => true", () => {
    // [10:00,12:00) contém [10:30,11:00)
    expect(overlaps(t(10), t(12), t(10, 30), t(11))).toBe(true);
    // e vice-versa (b contém a)
    expect(overlaps(t(10, 30), t(11), t(10), t(12))).toBe(true);
  });

  it("intervalos totalmente separados => false", () => {
    // [10:00,11:00) x [12:00,13:00)
    expect(overlaps(t(10), t(11), t(12), t(13))).toBe(false);
  });

  it("bordas que apenas se tocam NÃO são conflito", () => {
    // aEnd === bStart
    expect(overlaps(t(10), t(11), t(11), t(12))).toBe(false);
    // bEnd === aStart
    expect(overlaps(t(11), t(12), t(10), t(11))).toBe(false);
  });

  it("é comutativo", () => {
    const a1 = t(10);
    const a2 = t(11);
    const b1 = t(10, 30);
    const b2 = t(11, 30);
    expect(overlaps(a1, a2, b1, b2)).toBe(overlaps(b1, b2, a1, a2));
  });
});

describe("isWithinWorkingHours", () => {
  // 09:00–18:00 com almoço 12:00–13:00
  const win = (): DayWindow[] => [
    { startMinute: 9 * 60, endMinute: 18 * 60, breakStart: 12 * 60, breakEnd: 13 * 60 },
  ];

  it("slot inteiramente dentro da janela (fora do almoço) => true", () => {
    // 10:00–11:00
    expect(isWithinWorkingHours(10 * 60, 11 * 60, win())).toBe(true);
    // à tarde, 14:00–15:00
    expect(isWithinWorkingHours(14 * 60, 15 * 60, win())).toBe(true);
  });

  it("slot antes da abertura => false", () => {
    // 08:00–09:00
    expect(isWithinWorkingHours(8 * 60, 9 * 60, win())).toBe(false);
  });

  it("slot depois do fechamento => false", () => {
    // 18:00–19:00 e 17:30–18:30 (transborda o fim)
    expect(isWithinWorkingHours(18 * 60, 19 * 60, win())).toBe(false);
    expect(isWithinWorkingHours(17 * 60 + 30, 18 * 60 + 30, win())).toBe(false);
  });

  it("slot que atravessa o almoço => false", () => {
    // 11:30–12:30 encosta no break
    expect(isWithinWorkingHours(11 * 60 + 30, 12 * 60 + 30, win())).toBe(false);
    // 12:00–13:00 exatamente o break
    expect(isWithinWorkingHours(12 * 60, 13 * 60, win())).toBe(false);
    // 12:15–12:45 dentro do break
    expect(isWithinWorkingHours(12 * 60 + 15, 12 * 60 + 45, win())).toBe(false);
  });

  it("slot que apenas encosta nas bordas do almoço => true", () => {
    // termina exatamente às 12:00 (fim exclusivo do slot toca o início do break)
    expect(isWithinWorkingHours(11 * 60, 12 * 60, win())).toBe(true);
    // começa exatamente às 13:00
    expect(isWithinWorkingHours(13 * 60, 14 * 60, win())).toBe(true);
  });

  it("dia sem janelas => false (sem expediente)", () => {
    expect(isWithinWorkingHours(10 * 60, 11 * 60, [])).toBe(false);
  });

  it("janela sem pausa aceita qualquer slot que caiba", () => {
    const noBreak: DayWindow[] = [{ startMinute: 9 * 60, endMinute: 18 * 60 }];
    expect(isWithinWorkingHours(12 * 60, 13 * 60, noBreak)).toBe(true);
  });

  it("múltiplas janelas: cabe em ao menos uma => true", () => {
    // manhã 09–12, tarde 13–18 como janelas separadas
    const split: DayWindow[] = [
      { startMinute: 9 * 60, endMinute: 12 * 60 },
      { startMinute: 13 * 60, endMinute: 18 * 60 },
    ];
    expect(isWithinWorkingHours(14 * 60, 15 * 60, split)).toBe(true);
    // 12:30–13:00 não cabe em nenhuma
    expect(isWithinWorkingHours(12 * 60 + 30, 13 * 60, split)).toBe(false);
  });

  it("pausa inválida (breakEnd <= breakStart) é ignorada", () => {
    const bad: DayWindow[] = [
      { startMinute: 9 * 60, endMinute: 18 * 60, breakStart: 13 * 60, breakEnd: 12 * 60 },
    ];
    expect(isWithinWorkingHours(12 * 60, 13 * 60, bad)).toBe(true);
  });
});

describe("localWeekdayAndMinutes", () => {
  it("projeta um instante UTC em America/Sao_Paulo (UTC-3)", () => {
    // 2026-07-06 é uma segunda-feira. 13:30 UTC => 10:30 em São Paulo.
    const date = new Date("2026-07-06T13:30:00.000Z");
    const { weekday, minuteOfDay } = localWeekdayAndMinutes(
      date,
      "America/Sao_Paulo",
    );
    expect(weekday).toBe(1); // segunda
    expect(minuteOfDay).toBe(10 * 60 + 30);
  });

  it("cruza a virada do dia por causa do fuso (UTC-3)", () => {
    // 2026-07-07T02:00Z => 2026-07-06 23:00 em São Paulo (ainda segunda)
    const date = new Date("2026-07-07T02:00:00.000Z");
    const { weekday, minuteOfDay } = localWeekdayAndMinutes(
      date,
      "America/Sao_Paulo",
    );
    expect(weekday).toBe(1); // segunda
    expect(minuteOfDay).toBe(23 * 60);
  });

  it("domingo mapeia para 0", () => {
    // 2026-07-05 é domingo; 15:00Z => 12:00 em São Paulo
    const date = new Date("2026-07-05T15:00:00.000Z");
    const { weekday, minuteOfDay } = localWeekdayAndMinutes(
      date,
      "America/Sao_Paulo",
    );
    expect(weekday).toBe(0);
    expect(minuteOfDay).toBe(12 * 60);
  });

  it("UTC puro devolve o próprio horário", () => {
    const date = new Date("2026-07-06T08:15:00.000Z");
    const { weekday, minuteOfDay } = localWeekdayAndMinutes(date, "UTC");
    expect(weekday).toBe(1);
    expect(minuteOfDay).toBe(8 * 60 + 15);
  });
});
