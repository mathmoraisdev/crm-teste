import { describe, it, expect } from "vitest";
import {
  dueReminder,
  reminderMessage,
  renderReminderTemplate,
} from "./meeting-reminders";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-29T12:00:00.000Z");
const at = (msFromNow: number) => new Date(now.getTime() + msFromNow);
const base = { now, remindedDayBeforeAt: null, remindedHourBeforeAt: null };

describe("dueReminder", () => {
  it("falta ~20h: dispara lembrete de véspera", () => {
    expect(dueReminder({ ...base, scheduledAt: at(20 * HOUR) })).toBe("day_before");
  });

  it("falta ~40min: dispara lembrete de 1h", () => {
    expect(dueReminder({ ...base, scheduledAt: at(40 * 60 * 1000) })).toBe("hour_before");
  });

  it("janela morta entre 1h e 2h: nada (véspera já saiu antes)", () => {
    expect(dueReminder({ ...base, scheduledAt: at(90 * 60 * 1000) })).toBeNull();
  });

  it("reunião no passado: nenhum lembrete", () => {
    expect(dueReminder({ ...base, scheduledAt: at(-HOUR) })).toBeNull();
  });

  it("não repete a véspera se já foi enviada", () => {
    expect(
      dueReminder({ ...base, scheduledAt: at(20 * HOUR), remindedDayBeforeAt: now }),
    ).toBeNull();
  });

  it("não repete o de 1h se já foi enviado", () => {
    expect(
      dueReminder({ ...base, scheduledAt: at(30 * 60 * 1000), remindedHourBeforeAt: now }),
    ).toBeNull();
  });

  it("marcado em cima da hora (~90min): pula véspera, mas ainda manda o de 1h depois", () => {
    // 90min: nem véspera (precisa > 2h) nem 1h (precisa ≤ 1h) → nada agora…
    expect(dueReminder({ ...base, scheduledAt: at(90 * 60 * 1000) })).toBeNull();
    // …e quando faltar 50min, sai o de 1h normalmente.
    expect(dueReminder({ ...base, scheduledAt: at(50 * 60 * 1000) })).toBe("hour_before");
  });
});

describe("renderReminderTemplate", () => {
  it("substitui placeholders", () => {
    const out = renderReminderTemplate("Oi {{nome}}, é {{quando}}. {{link}}", {
      nome: "Ana",
      quando: "seg 10h",
      link: "https://x",
    });
    expect(out).toBe("Oi Ana, é seg 10h. https://x");
  });

  it("colapsa o buraco de um {{link}} vazio (sem deixar linha em branco)", () => {
    const out = renderReminderTemplate("📅 {{quando}}\n{{link}}\n\nAté lá!", {
      nome: "Ana",
      quando: "seg 10h",
      link: "",
    });
    expect(out).toBe("📅 seg 10h\n\nAté lá!");
  });
});

describe("reminderMessage", () => {
  const lead = { name: "Maria Silva" };
  const at10 = new Date("2026-06-29T13:00:00.000Z");

  it("usa o template do número quando informado (com {{nome}} = primeiro nome)", () => {
    const msg = reminderMessage("day_before", lead, at10, "https://meet/x", {
      dayBefore: "Ei {{nome}}, amanhã às {{quando}}! {{link}}",
    });
    expect(msg).toContain("Ei Maria, amanhã às");
    expect(msg).toContain("https://meet/x");
    expect(msg).not.toContain("Silva"); // primeiro nome só
  });

  it("cai no texto padrão quando o template do número é vazio", () => {
    const msg = reminderMessage("hour_before", lead, at10, null, { hourBefore: "  " });
    expect(msg).toContain("daqui a pouco");
  });
});
