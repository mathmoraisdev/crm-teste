import { describe, it, expect } from "vitest";
import { slaState } from "./sla";

const base = new Date("2026-07-07T12:00:00.000Z");
function minsAgo(min: number) {
  return new Date(base.getTime() - min * 60_000);
}

describe("slaState", () => {
  it("sem meta (null) → sempre ok, mas reporta a espera", () => {
    const s = slaState({ queuedAt: minsAgo(60), firstResponseAt: null, targetMinutes: null, now: base });
    expect(s.status).toBe("ok");
    expect(s.waitingMs).toBe(60 * 60_000);
  });

  it("meta 0 é tratada como sem meta", () => {
    const s = slaState({ queuedAt: minsAgo(60), firstResponseAt: null, targetMinutes: 0, now: base });
    expect(s.status).toBe("ok");
  });

  it("sem queuedAt → ok e espera zero", () => {
    const s = slaState({ queuedAt: null, firstResponseAt: null, targetMinutes: 5, now: base });
    expect(s.status).toBe("ok");
    expect(s.waitingMs).toBe(0);
  });

  it("na fila abaixo de 0.7×meta → ok", () => {
    // meta 10min; esperando 3min (< 7) → ok
    const s = slaState({ queuedAt: minsAgo(3), firstResponseAt: null, targetMinutes: 10, now: base });
    expect(s.status).toBe("ok");
  });

  it("na fila entre 0.7×meta e a meta → warning", () => {
    // meta 10min; esperando 8min (>7, <10) → warning
    const s = slaState({ queuedAt: minsAgo(8), firstResponseAt: null, targetMinutes: 10, now: base });
    expect(s.status).toBe("warning");
  });

  it("na fila acima da meta → breached", () => {
    // meta 5min; esperando 6min → breached
    const s = slaState({ queuedAt: minsAgo(6), firstResponseAt: null, targetMinutes: 5, now: base });
    expect(s.status).toBe("breached");
    expect(s.waitingMs).toBe(6 * 60_000);
  });

  it("já respondida → ok mesmo que tenha demorado; mede firstResponseAt - queuedAt", () => {
    const queuedAt = minsAgo(30);
    const firstResponseAt = minsAgo(20); // respondeu 10min após entrar na fila
    const s = slaState({ queuedAt, firstResponseAt, targetMinutes: 5, now: base });
    expect(s.status).toBe("ok");
    expect(s.waitingMs).toBe(10 * 60_000);
  });

  it("waitingMs nunca é negativo", () => {
    // resposta antes da fila (dados inconsistentes) → clampa em 0
    const s = slaState({ queuedAt: base, firstResponseAt: minsAgo(5), targetMinutes: 5, now: base });
    expect(s.waitingMs).toBe(0);
  });
});
