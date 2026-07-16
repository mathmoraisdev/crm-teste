import { describe, it, expect } from "vitest";
import { decideInboundMode } from "./inbound-mode";

const base = { autoReplyEnabled: true, qualifyEnabled: false, scheduleEnabled: false };

describe("decideInboundMode", () => {
  it("atendimento puro: responde, não qualifica, não agenda", () => {
    expect(decideInboundMode(base)).toEqual({ reply: true, qualify: false, allowSchedule: false });
  });
  it("com qualificação ligada", () => {
    expect(decideInboundMode({ ...base, qualifyEnabled: true }).qualify).toBe(true);
  });
  it("com agendamento ligado", () => {
    expect(decideInboundMode({ ...base, scheduleEnabled: true }).allowSchedule).toBe(true);
  });
  it("autoReply desligado: não responde (handoff total p/ humano)", () => {
    expect(decideInboundMode({ ...base, autoReplyEnabled: false }).reply).toBe(false);
  });
});
