import { describe, it, expect } from "vitest";
import { decidePipeline, SCORE_QUALIFY, SCORE_DISCARD } from "./pipeline";

/**
 * pipeline.ts é a única regra de negócio pura do fluxo — vale testar as
 * transições por score/nextAction de forma isolada (sem banco nem IA).
 */
describe("decidePipeline", () => {
  it("qualifica quando score >= 70", () => {
    const d = decidePipeline({
      current: "EM_CONVERSA",
      score: SCORE_QUALIFY,
      nextAction: "ask_question",
    });
    expect(d.status).toBe("QUALIFICADO");
    expect(d.shouldSchedule).toBe(true);
    expect(d.shouldReply).toBe(false);
  });

  it("qualifica quando a IA pede schedule_meeting (mesmo com score < 70)", () => {
    const d = decidePipeline({
      current: "EM_CONVERSA",
      score: 55,
      nextAction: "schedule_meeting",
    });
    expect(d.status).toBe("QUALIFICADO");
    expect(d.shouldSchedule).toBe(true);
  });

  it("descarta apenas com score baixo E sinal explícito de desinteresse", () => {
    const d = decidePipeline({
      current: "EM_CONVERSA",
      score: SCORE_DISCARD - 1,
      nextAction: "discard",
    });
    expect(d.status).toBe("DESCARTADO");
    expect(d.shouldDiscard).toBe(true);
    expect(d.shouldReply).toBe(false);
  });

  it("NÃO descarta lead novo/frio (score baixo mas sem sinal de descarte)", () => {
    const d = decidePipeline({
      current: "EM_CONVERSA",
      score: 20,
      nextAction: "ask_question",
    });
    expect(d.status).toBe("EM_CONVERSA");
    expect(d.shouldReply).toBe(true);
    expect(d.shouldDiscard).toBe(false);
  });

  it("permanece em conversa na faixa intermediária (40–69)", () => {
    const d = decidePipeline({
      current: "EM_CONVERSA",
      score: 55,
      nextAction: "ask_question",
    });
    expect(d.status).toBe("EM_CONVERSA");
    expect(d.shouldReply).toBe(true);
  });

  it("não reage mais em estados terminais (reunião agendada)", () => {
    const d = decidePipeline({
      current: "REUNIAO_AGENDADA",
      score: 90,
      nextAction: "schedule_meeting",
    });
    expect(d.status).toBe("REUNIAO_AGENDADA");
    expect(d.shouldSchedule).toBe(false);
    expect(d.shouldReply).toBe(false);
  });

  it("não reprocessa lead já descartado", () => {
    const d = decidePipeline({
      current: "DESCARTADO",
      score: 80,
      nextAction: "schedule_meeting",
    });
    expect(d.status).toBe("DESCARTADO");
    expect(d.shouldSchedule).toBe(false);
  });

  it("send_offer → shouldOffer true, status OFERTA_ENVIADA (mesmo com score alto)", () => {
    const d = decidePipeline({ current: "EM_CONVERSA", score: 80, nextAction: "send_offer" });
    expect(d.shouldOffer).toBe(true);
    expect(d.status).toBe("OFERTA_ENVIADA");
    expect(d.shouldSchedule).toBe(false);
    expect(d.shouldReply).toBe(false);
  });

  it("estados terminais (PAGO/DESCARTADO) não reagem a send_offer", () => {
    expect(decidePipeline({ current: "PAGO", score: 90, nextAction: "send_offer" }).shouldOffer).toBe(false);
    expect(decidePipeline({ current: "DESCARTADO", score: 90, nextAction: "send_offer" }).shouldOffer).toBe(false);
  });
});
