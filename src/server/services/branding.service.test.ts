import { describe, it, expect } from "vitest";
import { resolveBranding, DEFAULT_APP_NAME } from "./branding.service";
import { DEFAULT_PALETTE } from "@/lib/theme/palette";

describe("resolveBranding", () => {
  it("sem branding → tudo default", () => {
    const r = resolveBranding(null);
    expect(r.palette).toEqual(DEFAULT_PALETTE);
    expect(r.appName).toBe(DEFAULT_APP_NAME);
    expect(r.logoUrl).toBeNull();
  });

  it("brandScale válida sobrescreve a paleta", () => {
    const scale = { ...DEFAULT_PALETTE, "500": "220 38 38" };
    const r = resolveBranding({ brandScale: scale, appName: "Clínica X", logoUrl: "u", presetId: "x" } as never);
    expect(r.palette["500"]).toBe("220 38 38");
    expect(r.appName).toBe("Clínica X");
    expect(r.logoUrl).toBe("u");
  });

  it("brandScale inválida (parada faltando) cai no default — nunca renderiza cor quebrada", () => {
    const r = resolveBranding({ brandScale: { "500": "1 2 3" }, appName: null, logoUrl: null, presetId: null } as never);
    expect(r.palette).toEqual(DEFAULT_PALETTE);
  });

  it("businessAddress: trim; vazio/ausente → null", () => {
    expect(resolveBranding(null).businessAddress).toBeNull();
    expect(resolveBranding({ businessAddress: "  Rua A, 1  " } as never).businessAddress).toBe("Rua A, 1");
    expect(resolveBranding({ businessAddress: "   " } as never).businessAddress).toBeNull();
  });
});
