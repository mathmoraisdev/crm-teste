// src/lib/agenda/availability.test.ts
import { describe, it, expect } from "vitest";
import {
  appointmentEnd,
  overlaps,
  isWithinWorkingHours,
  localWeekdayAndMinutes,
  zonedWallTimeToUtc,
  enumerateLocalDates,
  computeDaySlots,
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

describe("zonedWallTimeToUtc", () => {
  it("09:00 em America/Sao_Paulo (UTC-3) cai às 12:00 UTC", () => {
    // 2026-07-06 é segunda; 09:00 local => 12:00Z
    const d = zonedWallTimeToUtc(2026, 7, 6, 9 * 60, "America/Sao_Paulo");
    expect(d.toISOString()).toBe("2026-07-06T12:00:00.000Z");
  });

  it("meia-noite (minuto 0) local => 03:00Z em São Paulo", () => {
    const d = zonedWallTimeToUtc(2026, 7, 6, 0, "America/Sao_Paulo");
    expect(d.toISOString()).toBe("2026-07-06T03:00:00.000Z");
  });

  it("fuso UTC (offset zero) devolve a própria parede", () => {
    const d = zonedWallTimeToUtc(2026, 7, 6, 8 * 60 + 15, "UTC");
    expect(d.toISOString()).toBe("2026-07-06T08:15:00.000Z");
  });

  it("fuso com DST (America/New_York) num dia de verão => EDT (UTC-4)", () => {
    // Julho = horário de verão em NY (EDT, UTC-4). 09:00 local => 13:00Z.
    const d = zonedWallTimeToUtc(2026, 7, 6, 9 * 60, "America/New_York");
    expect(d.toISOString()).toBe("2026-07-06T13:00:00.000Z");
  });

  it("round-trip: localWeekdayAndMinutes(zonedWallTimeToUtc(...)) preserva minuto e weekday", () => {
    const cases: Array<{ y: number; mo: number; d: number; min: number; tz: string; wd: number }> = [
      { y: 2026, mo: 7, d: 6, min: 9 * 60, tz: "America/Sao_Paulo", wd: 1 }, // segunda
      { y: 2026, mo: 7, d: 5, min: 0, tz: "America/Sao_Paulo", wd: 0 }, // domingo, meia-noite
      { y: 2026, mo: 12, d: 25, min: 14 * 60 + 30, tz: "America/New_York", wd: 5 }, // sexta (inverno, EST)
      { y: 2026, mo: 7, d: 1, min: 23 * 60 + 45, tz: "UTC", wd: 3 }, // quarta
    ];
    for (const c of cases) {
      const utc = zonedWallTimeToUtc(c.y, c.mo, c.d, c.min, c.tz);
      const { weekday, minuteOfDay } = localWeekdayAndMinutes(utc, c.tz);
      expect(minuteOfDay).toBe(c.min);
      expect(weekday).toBe(c.wd);
    }
  });
});

describe("enumerateLocalDates", () => {
  it("intervalo meio-aberto [seg 06, sex 09) lista 3 dias com weekday correto (São Paulo)", () => {
    // meio-aberto: inclui 06/07/08, exclui a meia-noite de 09 (= toUtc).
    const from = zonedWallTimeToUtc(2026, 7, 6, 0, "America/Sao_Paulo");
    const to = zonedWallTimeToUtc(2026, 7, 9, 0, "America/Sao_Paulo");
    const days = enumerateLocalDates(from, to, "America/Sao_Paulo");
    expect(days.map((d) => `${d.year}-${d.month}-${d.day}`)).toEqual([
      "2026-7-6",
      "2026-7-7",
      "2026-7-8",
    ]);
    expect(days.map((d) => d.weekday)).toEqual([1, 2, 3]); // seg, ter, qua
  });

  it("um dia só: [meia-noite, meia-noite+1d) rende exatamente esse dia", () => {
    const from = zonedWallTimeToUtc(2026, 7, 9, 0, "America/Sao_Paulo");
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000); // meia-noite seguinte
    const days = enumerateLocalDates(from, to, "America/Sao_Paulo");
    expect(days.map((d) => `${d.year}-${d.month}-${d.day}`)).toEqual(["2026-7-9"]);
  });

  it("virada de mês, meio-aberto [30/06, 03/07)", () => {
    const from = zonedWallTimeToUtc(2026, 6, 30, 0, "America/Sao_Paulo");
    const to = zonedWallTimeToUtc(2026, 7, 3, 0, "America/Sao_Paulo");
    const days = enumerateLocalDates(from, to, "America/Sao_Paulo");
    expect(days.map((d) => `${d.year}-${d.month}-${d.day}`)).toEqual([
      "2026-6-30",
      "2026-7-1",
      "2026-7-2",
    ]);
  });

  it("começa/termina no meio do dia: só conta os 00:00 que caem no intervalo", () => {
    // from = seg 06 10:00 local (03+10=13:00Z? não: 10:00 local = 13:00Z). A meia-noite
    // de seg 06 (03:00Z) é ANTES de from → seg 06 fica de fora. to = qua 08 10:00 local.
    const from = zonedWallTimeToUtc(2026, 7, 6, 10 * 60, "America/Sao_Paulo");
    const to = zonedWallTimeToUtc(2026, 7, 8, 10 * 60, "America/Sao_Paulo");
    const days = enumerateLocalDates(from, to, "America/Sao_Paulo");
    // 00:00 de ter 07 e qua 08 caem dentro; seg 06 não (sua meia-noite ficou antes).
    expect(days.map((d) => `${d.year}-${d.month}-${d.day}`)).toEqual([
      "2026-7-7",
      "2026-7-8",
    ]);
  });

  it("intervalo vazio/invertido → []", () => {
    const a = zonedWallTimeToUtc(2026, 7, 8, 0, "America/Sao_Paulo");
    const b = zonedWallTimeToUtc(2026, 7, 6, 0, "America/Sao_Paulo");
    expect(enumerateLocalDates(a, b, "America/Sao_Paulo")).toEqual([]);
  });
});

describe("computeDaySlots (a jóia da coroa)", () => {
  const TZ = "America/Sao_Paulo";
  const DATE = { year: 2026, month: 7, day: 6 }; // segunda
  // Um piso de antecedência bem no passado (não corta nada, salvo o teste dele).
  const FAR_PAST = new Date("2020-01-01T00:00:00.000Z");
  // Hora local (min do dia) → o Date UTC esperado nesse fuso/dia.
  const at = (minute: number) => zonedWallTimeToUtc(DATE.year, DATE.month, DATE.day, minute, TZ);
  const H = (h: number, m = 0) => h * 60 + m;

  it("janela 09–12, serviço 60min, passo 30 → 09:00/09:30/10:00/10:30/11:00", () => {
    const slots = computeDaySlots({
      date: DATE,
      timeZone: TZ,
      windows: [{ startMinute: H(9), endMinute: H(12) }],
      busy: [],
      durationMinutes: 60,
      stepMinutes: 30,
      notBefore: FAR_PAST,
    });
    expect(slots.map((s) => s.getTime())).toEqual(
      [H(9), H(9, 30), H(10), H(10, 30), H(11)].map((m) => at(m).getTime()),
    );
  });

  it("um busy 10:00–11:00 remove 09:30/10:00/10:30", () => {
    const slots = computeDaySlots({
      date: DATE,
      timeZone: TZ,
      windows: [{ startMinute: H(9), endMinute: H(12) }],
      busy: [{ start: at(H(10)), end: at(H(11)) }],
      durationMinutes: 60,
      stepMinutes: 30,
      notBefore: FAR_PAST,
    });
    // sobram 09:00 (09–10) e 11:00 (11–12); 09:30/10:00/10:30 colidem com [10,11)
    expect(slots.map((s) => s.getTime())).toEqual([at(H(9)).getTime(), at(H(11)).getTime()]);
  });

  it("pausa 12:00–13:00 numa janela 09–18 não oferta slot que a atravesse", () => {
    const slots = computeDaySlots({
      date: DATE,
      timeZone: TZ,
      windows: [{ startMinute: H(9), endMinute: H(18), breakStart: H(12), breakEnd: H(13) }],
      busy: [],
      durationMinutes: 60,
      stepMinutes: 60,
      notBefore: FAR_PAST,
    });
    const localMinutes = slots.map((s) => localWeekdayAndMinutes(s, TZ).minuteOfDay);
    // nenhum slot começa às 12:00 (atravessaria a pausa até 13:00)
    expect(localMinutes).not.toContain(H(12));
    // 11:00 (11–12, encosta) e 13:00 (13–14) existem
    expect(localMinutes).toContain(H(11));
    expect(localMinutes).toContain(H(13));
  });

  it("notBefore 10:15 corta os inícios anteriores", () => {
    const slots = computeDaySlots({
      date: DATE,
      timeZone: TZ,
      windows: [{ startMinute: H(9), endMinute: H(12) }],
      busy: [],
      durationMinutes: 60,
      stepMinutes: 30,
      notBefore: at(H(10, 15)), // 10:15 local
    });
    // 09:00/09:30/10:00 (< 10:15) caem; sobram 10:30 e 11:00
    expect(slots.map((s) => s.getTime())).toEqual([at(H(10, 30)).getTime(), at(H(11)).getTime()]);
  });

  it("sem janela → []", () => {
    expect(
      computeDaySlots({
        date: DATE,
        timeZone: TZ,
        windows: [],
        busy: [],
        durationMinutes: 30,
        stepMinutes: 15,
        notBefore: FAR_PAST,
      }),
    ).toEqual([]);
  });

  it("duração que não cabe na janela → []", () => {
    expect(
      computeDaySlots({
        date: DATE,
        timeZone: TZ,
        windows: [{ startMinute: H(9), endMinute: H(10) }], // 1h de janela
        busy: [],
        durationMinutes: 90, // serviço de 1h30 não cabe
        stepMinutes: 15,
        notBefore: FAR_PAST,
      }),
    ).toEqual([]);
  });

  it("deduplica e ordena entre janelas sobrepostas", () => {
    const slots = computeDaySlots({
      date: DATE,
      timeZone: TZ,
      windows: [
        { startMinute: H(9), endMinute: H(11) },
        { startMinute: H(10), endMinute: H(12) }, // sobrepõe às 10:00/10:30
      ],
      busy: [],
      durationMinutes: 30,
      stepMinutes: 30,
      notBefore: FAR_PAST,
    });
    const times = slots.map((s) => s.getTime());
    // ordenado crescente e sem repetição
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    // cobre 09:00..11:30 (união das janelas)
    expect(times).toEqual(
      [H(9), H(9, 30), H(10), H(10, 30), H(11), H(11, 30)].map((m) => at(m).getTime()),
    );
  });
});
