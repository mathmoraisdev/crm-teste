import { describe, it, expect, vi, beforeEach } from "vitest";

// env.ts exige DATABASE_URL.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

// Regressão do bug "IA não responde quando o remetente é OUTRO número conectado ao
// sistema": o providerMessageId (WA key.id) é o MESMO p/ remetente e destinatário.
// Com a unique GLOBAL antiga, o inbound do destinatário colidia (P2002) ou era
// deduplicado contra a cópia outbound do remetente → a IA nunca rodava. A unique
// passou a ser POR LEAD; o dedupe também. Estes testes travam esse contrato.

const lead = {
  id: "lead-dest",
  userId: "user-dest",
  whatsAppNumberId: "num-dest",
  attendanceStatus: "IA", // != RESOLVIDA → reopenIfResolved é no-op
  aiPaused: false,
  status: "EM_CONVERSA",
};

vi.mock("@/server/db/client", () => ({
  prisma: {
    message: {
      findFirst: vi.fn(async () => null), // dedupe (por lead) + check de OUTBOUND: nada
      create: vi.fn(async () => ({ id: "msg-1" })),
    },
    lead: {
      findFirst: vi.fn(async () => lead), // resolveLead acha o lead do destinatário
      update: vi.fn(async () => ({})),
    },
    whatsAppNumber: {
      findUnique: vi.fn(async () => ({ replyDelaySeconds: 0, firstReplyDelaySeconds: 0 })),
    },
  },
}));

vi.mock("@/server/services/account.service", () => ({
  isAccountActiveByLead: vi.fn(async () => true), // gate de billing passa
}));

vi.mock("@/server/cache/keys", () => ({
  cacheKeys: { conversation: (id: string) => `conv:${id}` },
  invalidateConversation: vi.fn(async () => {}),
  invalidateLeadCaches: vi.fn(async () => {}),
}));

const input = {
  phone: "+554898121775",
  whatsAppNumberId: "num-dest",
  text: "Bom dia, irmão",
  providerMessageId: "3EB0COMPARTILHADO", // MESMA id que a cópia outbound do remetente
};

describe("ingestInbound — providerMessageId com escopo por lead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dedupe é ESCOPADO ao lead (where inclui leadId), não global", async () => {
    const { prisma } = await import("@/server/db/client");
    const { ingestInbound } = await import("./conversation.service");

    await ingestInbound(input);

    // 1ª chamada de message.findFirst = o dedupe. Precisa filtrar por leadId, senão
    // a mesma id em OUTRA conta bloquearia este inbound legítimo.
    const dedupeWhere = (prisma.message.findFirst as any).mock.calls[0][0].where;
    expect(dedupeWhere.providerMessageId).toBe("3EB0COMPARTILHADO");
    expect(dedupeWhere.leadId).toBe("lead-dest");
  });

  it("a mesma id existindo em OUTRO lead NÃO bloqueia: grava inbound e responde", async () => {
    const { prisma } = await import("@/server/db/client");
    const { ingestInbound } = await import("./conversation.service");

    // findFirst com escopo no lead do destinatário não encontra nada (a cópia com a
    // mesma id pertence ao lead do remetente, em outra conta) → segue normal.
    const res = await ingestInbound(input);

    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect((prisma.message.create as any).mock.calls[0][0].data.direction).toBe("INBOUND");
    expect(res.respond).toBe(true);
    expect(res.deduped).toBeUndefined();
  });

  it("colisão de reentrega (P2002 no create, mesmo lead) → deduped, sem throw nem resposta", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.message.create as any).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const { ingestInbound } = await import("./conversation.service");

    const res = await ingestInbound(input);

    expect(res.deduped).toBe(true);
    expect(res.respond).toBe(false);
    expect(res.leadId).toBe("lead-dest");
  });
});
