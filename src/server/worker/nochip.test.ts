import { describe, it, expect } from "vitest";
import { decideNoChipAction } from "./nochip";

describe("decideNoChipAction", () => {
  it("adia enquanto abaixo do limite de tentativas", () => {
    expect(decideNoChipAction(0, 5)).toEqual({ action: "defer" });
    expect(decideNoChipAction(4, 5)).toEqual({ action: "defer" });
  });

  it("pausa a campanha ao atingir o limite (todos os chips fora)", () => {
    expect(decideNoChipAction(5, 5)).toEqual({ action: "pause_campaign" });
    expect(decideNoChipAction(9, 5)).toEqual({ action: "pause_campaign" });
  });
});
