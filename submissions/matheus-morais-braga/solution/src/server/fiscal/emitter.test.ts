import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
});

describe("fiscal emitter", () => {
  it("centsToReaisString formata centavos → reais com 2 casas (string, sem R$)", async () => {
    const { centsToReaisString } = await import("./emitter");
    expect(centsToReaisString(1000)).toBe("10.00");
    expect(centsToReaisString(1)).toBe("0.01");
    expect(centsToReaisString(123456)).toBe("1234.56");
  });

  it("fiscalEmitterFor devolve um emissor por provedor", async () => {
    const { fiscalEmitterFor } = await import("./emitter");
    expect(fiscalEmitterFor("FOCUS_NFE")).toBeTruthy();
  });
});
