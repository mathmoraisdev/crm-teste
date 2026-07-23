import { describe, it, expect } from "vitest";
import { isStoreOpen } from "./hours";
import type { DeliveryHours } from "@/server/services/delivery-settings.service";

// Fixo: quarta-feira 08/07/2026 14:00 UTC. America/Sao_Paulo = 11:00 (UTC-3).
const WED_11H_BRT = new Date("2026-07-08T14:00:00Z");
// 18:00 UTC = 15:00 BRT (dentro de uma janela 12-23).
const WED_15H_BRT = new Date("2026-07-08T18:00:00Z");

describe("isStoreOpen", () => {
  it("hours null → sempre aberta", () => {
    expect(isStoreOpen(null, WED_11H_BRT, "America/Sao_Paulo")).toBe(true);
  });

  it("aberta quando cai dentro da janela do dia", () => {
    const hours: DeliveryHours = { "3": [{ open: "10:00", close: "23:00" }] }; // quarta
    expect(isStoreOpen(hours, WED_11H_BRT, "America/Sao_Paulo")).toBe(true);
  });

  it("fechada quando fora da janela do dia", () => {
    const hours: DeliveryHours = { "3": [{ open: "18:00", close: "23:00" }] };
    // 11:00 BRT < 18:00 → fechada
    expect(isStoreOpen(hours, WED_11H_BRT, "America/Sao_Paulo")).toBe(false);
  });

  it("fechada quando o dia não tem janela", () => {
    const hours: DeliveryHours = { "1": [{ open: "10:00", close: "18:00" }] }; // só segunda
    expect(isStoreOpen(hours, WED_11H_BRT, "America/Sao_Paulo")).toBe(false);
  });

  it("respeita múltiplas janelas no mesmo dia (almoço + jantar)", () => {
    const hours: DeliveryHours = {
      "3": [
        { open: "11:00", close: "14:00" }, // almoço
        { open: "18:00", close: "23:00" }, // jantar
      ],
    };
    // 11:00 abre (limite inicial inclusivo)
    expect(isStoreOpen(hours, WED_11H_BRT, "America/Sao_Paulo")).toBe(true);
    // 15:00 entre as janelas → fechada
    expect(isStoreOpen(hours, WED_15H_BRT, "America/Sao_Paulo")).toBe(false);
  });

  it("limite final é exclusivo (close = horário de fechar)", () => {
    const hours: DeliveryHours = { "3": [{ open: "10:00", close: "11:00" }] };
    // exatamente 11:00 → já fechou (close exclusivo)
    expect(isStoreOpen(hours, WED_11H_BRT, "America/Sao_Paulo")).toBe(false);
  });
});
