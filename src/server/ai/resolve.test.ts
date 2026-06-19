import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.ENCRYPTION_KEY =
    "0000000000000000000000000000000000000000000000000000000000000000";
  process.env.OPENAI_API_KEY = "sk-platform-test";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe("getAiClient", () => {
  it("usa a credencial do usuário quando existe", async () => {
    const { prisma } = await import("@/server/db/client");
    const { encryptSecret } = await import("@/server/crypto");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: "ANTHROPIC",
      aiKeyEnc: encryptSecret("sk-ant-user"),
    });
    const { resolveProviderForUser } = await import("./resolve");
    const r = await resolveProviderForUser("user-1");
    expect(r.provider).toBe("ANTHROPIC");
    expect(r.apiKey).toBe("sk-ant-user");
    expect(r.source).toBe("user");
  });

  it("cai para a plataforma (OpenAI) quando o usuário não configurou", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: null,
      aiKeyEnc: null,
    });
    const { resolveProviderForUser } = await import("./resolve");
    const r = await resolveProviderForUser("user-2");
    expect(r.provider).toBe("OPENAI");
    expect(r.apiKey).toBe("sk-platform-test");
    expect(r.source).toBe("platform");
  });
});
