import { describe, it, expect } from "vitest";
import { cappedCampaignIds } from "./dispatcher";

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
