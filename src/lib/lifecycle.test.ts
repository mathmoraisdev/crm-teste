import { describe, it, expect } from "vitest";
import {
  isDueAfter,
  renderLifecycleTemplate,
  postSaleMessage,
  reviewMessage,
  reengageMessage,
} from "./lifecycle";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-07-08T15:00:00.000Z");
const at = (msFromNow: number) => new Date(now.getTime() + msFromNow);

describe("isDueAfter", () => {
  const base = { now, delayMs: 2 * HOUR, floorMs: 7 * 24 * HOUR, marker: null as Date | null };
  it("evento há 3h, atraso 2h, sem marcador → devido", () => {
    expect(isDueAfter({ ...base, eventAt: at(-3 * HOUR) })).toBe(true);
  });
  it("evento há 1h, atraso 2h → ainda NÃO (não passou o atraso)", () => {
    expect(isDueAfter({ ...base, eventAt: at(-1 * HOUR) })).toBe(false);
  });
  it("já enviado (marcador setado) → não repete", () => {
    expect(isDueAfter({ ...base, eventAt: at(-3 * HOUR), marker: now })).toBe(false);
  });
  it("evento antigo demais (antes do piso) → não toca backlog", () => {
    expect(isDueAfter({ ...base, eventAt: at(-10 * 24 * HOUR) })).toBe(false);
  });
  it("evento no futuro → nunca", () => {
    expect(isDueAfter({ ...base, eventAt: at(1 * HOUR) })).toBe(false);
  });
  it("atraso 0 (desligado) já é tratado FORA (o service nem chama); guard defensivo", () => {
    // com delayMs=0 e evento no passado, é devido — o gate de ligado/desligado é do service
    expect(isDueAfter({ ...base, delayMs: 0, eventAt: at(-1 * HOUR) })).toBe(true);
  });
});

describe("renderLifecycleTemplate", () => {
  it("substitui {{nome}} pelo primeiro nome", () => {
    expect(renderLifecycleTemplate("Oi, {{nome}}!", { nome: "Ana Paula" })).toBe("Oi, Ana Paula!");
  });
});

describe("mensagens", () => {
  it("pós-venda usa o primeiro nome", () => {
    expect(postSaleMessage({ name: "João Silva" })).toContain("João");
  });
  it("NPS pergunta a nota", () => {
    expect(reviewMessage({ name: "Maria" }).toLowerCase()).toMatch(/0 a 10|recomend/);
  });
  it("reengajamento é win-back", () => {
    expect(reengageMessage({ name: "Zé" })).toContain("Zé");
  });
});
