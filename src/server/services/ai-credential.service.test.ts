import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.ENCRYPTION_KEY =
    "0000000000000000000000000000000000000000000000000000000000000000";
});

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

describe("getAiCredentialStatus", () => {
  it("retorna mascarado quando configurado", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: "OPENAI",
      aiKeyLast4: "1234",
      aiKeyVerifiedAt: new Date("2026-06-19T00:00:00Z"),
    });
    const { getAiCredentialStatus } = await import("./ai-credential.service");
    const s = await getAiCredentialStatus("u1");
    expect(s).toEqual({
      configured: true,
      provider: "OPENAI",
      last4: "1234",
      verifiedAt: "2026-06-19T00:00:00.000Z",
    });
  });

  it("retorna não-configurado quando vazio", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: null,
      aiKeyLast4: null,
      aiKeyVerifiedAt: null,
    });
    const { getAiCredentialStatus } = await import("./ai-credential.service");
    expect((await getAiCredentialStatus("u1")).configured).toBe(false);
  });
});
