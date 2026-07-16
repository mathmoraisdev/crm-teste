import { describe, it, expect, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
});

describe("isAdminEmail", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "matheusmoraesbrg@gmail.com, Outro@Exemplo.com";
  });

  it("reconhece e-mail admin ignorando caixa e espaços", async () => {
    const { isAdminEmail } = await import("./admin");
    expect(isAdminEmail("MatheusMoraesBRG@gmail.com")).toBe(true);
    expect(isAdminEmail("outro@exemplo.com")).toBe(true);
  });

  it("nega e-mail fora da lista e valores vazios", async () => {
    const { isAdminEmail } = await import("./admin");
    expect(isAdminEmail("aleatorio@cliente.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});
