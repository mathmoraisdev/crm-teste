import { describe, it, expect } from "vitest";
import { cappedCampaignIds, underAccountCap, effectiveDailyCap } from "./dispatcher";

describe("cappedCampaignIds", () => {
  it("marca como no teto a campanha que já enviou >= dailyCap hoje", () => {
    const campaigns = [
      { id: "c1", dailyCap: 50 },
      { id: "c2", dailyCap: 50 },
    ];
    const sent = { c1: 50, c2: 49 };
    expect(cappedCampaignIds(campaigns, sent)).toEqual(["c1"]);
  });

  it("considera 0 envios quando a campanha não aparece no mapa", () => {
    expect(cappedCampaignIds([{ id: "c1", dailyCap: 10 }], {})).toEqual([]);
  });

  it("ignora campanhas sem teto próprio (dailyCap null)", () => {
    const sent = { c1: 9999 };
    expect(cappedCampaignIds([{ id: "c1", dailyCap: null }], sent)).toEqual([]);
  });

  it("também conta como no teto quando ultrapassa o cap", () => {
    expect(cappedCampaignIds([{ id: "c1", dailyCap: 5 }], { c1: 7 })).toEqual(["c1"]);
  });

  it("devolve vazio quando não há campanhas com teto", () => {
    expect(cappedCampaignIds([], { c1: 100 })).toEqual([]);
  });
});

describe("underAccountCap", () => {
  it("cap 0 = ilimitado (modo massa)", () => {
    expect(underAccountCap(999_999, 0)).toBe(true);
  });
  it("respeita o teto quando positivo", () => {
    expect(underAccountCap(999, 1000)).toBe(true);
    expect(underAccountCap(1000, 1000)).toBe(false);
  });
});

describe("effectiveDailyCap", () => {
  it("conta com pagamento lançado usa o cap normal", () => {
    expect(effectiveDailyCap(true, 0, 30)).toBe(0);   // pago em modo massa = ilimitado
    expect(effectiveDailyCap(true, 500, 30)).toBe(500);
  });
  it("conta sem pagamento (trial/cortesia) usa o teto de trial", () => {
    expect(effectiveDailyCap(false, 0, 30)).toBe(30);   // mesmo com normal ilimitado, trial trava em 30
    expect(effectiveDailyCap(false, 500, 30)).toBe(30);
  });
  it("teto de trial <= 0 desliga o recurso (cai no normal)", () => {
    expect(effectiveDailyCap(false, 500, 0)).toBe(500);
    expect(effectiveDailyCap(false, 0, 0)).toBe(0);
  });
});
