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

vi.mock("./provider", () => ({
  buildAiClient: vi.fn(() => ({ generateText: vi.fn(), forcedToolCall: vi.fn() })),
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

  it("chave da plataforma → força o modelo econômico em todas as chamadas", async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ aiProvider: null, aiKeyEnc: null });
    const { buildAiClient } = await import("./provider");
    const { getAiClient } = await import("./resolve");

    await getAiClient("user-2"); // sem modelo por número
    expect(buildAiClient).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "OPENAI", model: "gpt-4o-mini" }),
    );
  });

  it("chave da plataforma com modelo já resolvido (grandfather/admin) → usa esse modelo", async () => {
    // No fluxo real, plano comercial já chega com model=null (clampado por
    // resolveAiModelForUser); só grandfather/admin passam um modelo explícito aqui.
    vi.clearAllMocks();
    const { prisma } = await import("@/server/db/client");
    (prisma.user.findUnique as any).mockResolvedValue({ aiProvider: null, aiKeyEnc: null });
    const { buildAiClient } = await import("./provider");
    const { getAiClient } = await import("./resolve");

    await getAiClient("user-2", "gpt-4o");
    expect(buildAiClient).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" }),
    );
  });

  it("BYOK → NÃO força modelo; mantém os tiers do provider do cliente", async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@/server/db/client");
    const { encryptSecret } = await import("@/server/crypto");
    (prisma.user.findUnique as any).mockResolvedValue({
      aiProvider: "ANTHROPIC",
      aiKeyEnc: encryptSecret("sk-ant-user"),
    });
    const { buildAiClient } = await import("./provider");
    const { getAiClient } = await import("./resolve");

    await getAiClient("user-1"); // sem modelo por número → tiers do provider (model undefined)
    expect(buildAiClient).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "ANTHROPIC", model: undefined }),
    );
  });
});
