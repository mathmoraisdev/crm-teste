import { describe, it, expect } from "vitest";
import { generateToken, hashToken } from "./tokens";

describe("tokens", () => {
  it("gera tokens únicos, opacos e URL-safe", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-f0-9]+$/); // só hex, seguro em URL
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("hashToken é determinístico para o mesmo token", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("hashToken difere para tokens diferentes e não devolve o token claro", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64); // sha-256 hex
    expect(hashToken(generateToken())).not.toBe(hash);
  });
});
