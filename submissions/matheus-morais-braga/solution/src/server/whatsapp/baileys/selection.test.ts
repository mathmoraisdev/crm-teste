import { describe, it, expect } from "vitest";
import { selectNumber } from "./selection";

const N = (over: Partial<any> = {}) => ({
  id: "a", status: "CONNECTED", dailyCap: 30, sentToday: 0, ...over,
});

describe("selectNumber", () => {
  it("escolhe o número conectado MENOS carregado", () => {
    const r = selectNumber([
      N({ id: "a", sentToday: 10 }),
      N({ id: "b", sentToday: 3 }),
      N({ id: "c", sentToday: 7 }),
    ]);
    expect(r?.id).toBe("b");
  });

  it("ignora número que atingiu o próprio cap", () => {
    const r = selectNumber([
      N({ id: "a", sentToday: 30, dailyCap: 30 }),
      N({ id: "b", sentToday: 29, dailyCap: 30 }),
    ]);
    expect(r?.id).toBe("b");
  });

  it("ignora PAUSED/BANNED/DISABLED; WARMING e CONNECTED contam", () => {
    expect(selectNumber([N({ id: "a", status: "BANNED" })])).toBeNull();
    expect(selectNumber([N({ id: "a", status: "PAUSED" })])).toBeNull();
    expect(selectNumber([N({ id: "w", status: "WARMING", sentToday: 0 })])?.id).toBe("w");
  });

  it("retorna null quando todos estão no cap ou indisponíveis", () => {
    expect(selectNumber([N({ sentToday: 30, dailyCap: 30 })])).toBeNull();
    expect(selectNumber([])).toBeNull();
  });
});
