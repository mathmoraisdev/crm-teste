import { describe, it, expect } from "vitest";
import {
  renderApptReminderTemplate,
  apptReminderMessage,
  DEFAULT_APPT_REMINDER_DAY_BEFORE,
} from "./appointment-reminders";

// A decisão de janela (dueReminder) já é coberta por meeting-reminders.test.ts —
// aqui testamos só a renderização do template de SERVIÇO ({{servico}}).

describe("renderApptReminderTemplate", () => {
  it("substitui {{nome}}/{{servico}}/{{quando}}", () => {
    const out = renderApptReminderTemplate("Oi {{nome}}, seu {{servico}} em {{quando}}.", {
      nome: "Ana",
      servico: "Depilação",
      quando: "seg 10h",
    });
    expect(out).toBe("Oi Ana, seu Depilação em seg 10h.");
  });

  it("serviço vazio cai p/ 'atendimento' (frase não fica capenga)", () => {
    const out = renderApptReminderTemplate("Seu {{servico}} amanhã.", {
      nome: "Ana",
      servico: null,
      quando: "seg 10h",
    });
    expect(out).toBe("Seu atendimento amanhã.");
  });

  it("não deixa link nem buraco (template padrão de véspera, sem {{link}})", () => {
    const out = renderApptReminderTemplate(DEFAULT_APPT_REMINDER_DAY_BEFORE, {
      nome: "Maria Silva",
      servico: "Corte",
      quando: "amanhã 14h",
    });
    expect(out).toContain("Corte");
    expect(out).not.toContain("{{");
    expect(out).not.toMatch(/\n\n\n/);
  });
});

describe("apptReminderMessage", () => {
  const lead = { name: "Maria Silva" };
  const at = new Date("2026-08-01T17:00:00.000Z");

  it("usa primeiro nome e o serviço informado", () => {
    const msg = apptReminderMessage("day_before", lead, at, "Massagem");
    expect(msg).toContain("Maria");
    expect(msg).not.toContain("Silva");
    expect(msg).toContain("Massagem");
  });

  it("hora antes usa o texto de 1h ('daqui a pouco')", () => {
    const msg = apptReminderMessage("hour_before", lead, at, null);
    expect(msg).toContain("daqui a pouco");
    expect(msg).toContain("atendimento"); // fallback do serviço
  });

  it("usa o template do número quando informado (override)", () => {
    const msg = apptReminderMessage("day_before", lead, at, "Corte", {
      dayBefore: "Fala {{nome}}! Seu {{servico}} tá marcado.",
      hourBefore: "não usado",
    });
    expect(msg).toBe("Fala Maria! Seu Corte tá marcado.");
  });

  it("template vazio/espaços cai para o padrão", () => {
    const msg = apptReminderMessage("day_before", lead, at, "Corte", {
      dayBefore: "   ",
      hourBefore: null,
    });
    expect(msg).toContain("Lembrete: Corte amanhã"); // texto padrão de véspera
  });

  it("override respeita a janela (hour_before usa o texto de 1h, não o de véspera)", () => {
    const msg = apptReminderMessage("hour_before", lead, at, "Corte", {
      dayBefore: "TEXTO DE VESPERA",
      hourBefore: "Seu {{servico}} é já já, {{nome}}!",
    });
    expect(msg).toBe("Seu Corte é já já, Maria!");
  });
});
