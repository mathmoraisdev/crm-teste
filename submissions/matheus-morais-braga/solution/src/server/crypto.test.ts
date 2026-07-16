import { describe, it, expect, beforeAll } from "vitest";

// ENCRYPTION_KEY precisa existir antes de importar o módulo (lê via env).
beforeAll(() => {
  process.env.ENCRYPTION_KEY =
    "0000000000000000000000000000000000000000000000000000000000000000";
});

describe("crypto BYOK", () => {
  it("round-trip: decrypt(encrypt(x)) === x", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const secret = "sk-proj-abc123XYZ";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret); // cifrado, não texto puro
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("ciphertext difere a cada chamada (IV aleatório)", async () => {
    const { encryptSecret } = await import("./crypto");
    expect(encryptSecret("mesma-coisa")).not.toBe(encryptSecret("mesma-coisa"));
  });

  it("decrypt falha em payload adulterado", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto");
    const enc = encryptSecret("segredo");
    const tampered = enc.slice(0, -2) + (enc.endsWith("aa") ? "bb" : "aa");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
