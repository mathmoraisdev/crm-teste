import { describe, it, expect, vi, beforeEach } from "vitest";

// env.ts exige DATABASE_URL; ligamos a transcrição p/ exercitar o caminho novo.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
process.env.TRANSCRIBE_ENABLED = "true";
process.env.TRANSCRIBE_MAX_SECONDS = "300";

const lead = {
  id: "lead-1",
  userId: "user-1",
  whatsAppNumberId: "num-1",
  attendanceStatus: "IA", // != RESOLVIDA → reopenIfResolved é no-op
  aiPaused: false,
};

vi.mock("@/server/db/client", () => ({
  prisma: {
    message: {
      findUnique: vi.fn(async () => null), // dedupe: nada existente
      findFirst: vi.fn(async () => null), // sem OUTBOUND ainda → 1ª resposta
      create: vi.fn(async () => ({ id: "msg-1" })),
    },
    lead: { findFirst: vi.fn(async () => lead) },
    whatsAppNumber: {
      findUnique: vi.fn(async () => ({ replyDelaySeconds: 0, firstReplyDelaySeconds: 0 })),
    },
  },
}));

vi.mock("@/server/ai/transcribe", () => ({
  transcribeAudio: vi.fn(async () => "quero agendar uma reunião"),
}));

vi.mock("@/server/storage/media-storage", () => ({
  uploadInboundMedia: vi.fn(async () => "leads/lead-1/audio.ogg"),
}));

vi.mock("@/server/services/account.service", () => ({
  isAccountActiveByLead: vi.fn(async () => true), // conta ativa (gate de billing passa)
}));

vi.mock("@/server/cache/keys", () => ({
  cacheKeys: { conversation: (id: string) => `conv:${id}` },
  invalidateConversation: vi.fn(async () => {}),
  invalidateLeadCaches: vi.fn(async () => {}),
}));

const audioInput = {
  phone: "+5511999999999",
  whatsAppNumberId: "num-1",
  placeholder: "🎤 Áudio",
  providerMessageId: "prov-1",
  buffer: Buffer.from("fake-ogg-bytes"),
  mediaType: "audio" as const,
  mime: "audio/ogg; codecs=opus",
  fileName: "audio.ogg",
};

describe("ingestInboundMedia — transcrição de áudio", () => {
  beforeEach(() => vi.clearAllMocks());

  it("áudio curto: grava content=transcrição + mediaPath e sinaliza resposta", async () => {
    const { prisma } = await import("@/server/db/client");
    const { transcribeAudio } = await import("@/server/ai/transcribe");
    const { ingestInboundMedia } = await import("./conversation.service");

    const res = await ingestInboundMedia({ ...audioInput, audioSeconds: 30 });

    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ respond: true, leadId: "lead-1", delayMs: 0 });

    const createArg = (prisma.message.create as any).mock.calls[0][0];
    expect(createArg.data.content).toBe("quero agendar uma reunião"); // contexto da IA
    expect(createArg.data.mediaPath).toBe("leads/lead-1/audio.ogg"); // player do operador
    expect(createArg.data.direction).toBe("INBOUND");
  });

  it("conta suspensa: transcreve e grava, mas NÃO aciona a IA (gate de billing)", async () => {
    const { isAccountActiveByLead } = await import("@/server/services/account.service");
    (isAccountActiveByLead as any).mockResolvedValueOnce(false);
    const { ingestInboundMedia } = await import("./conversation.service");

    const res = await ingestInboundMedia({ ...audioInput, audioSeconds: 30 });

    // Transcrição/mensagem acontecem (operador vê), mas a IA fica muda.
    expect(res).toEqual({ respond: false, leadId: "lead-1", delayMs: 0 });
  });

  it("áudio longo (> teto): não transcreve, content=placeholder, não responde", async () => {
    const { prisma } = await import("@/server/db/client");
    const { transcribeAudio } = await import("@/server/ai/transcribe");
    const { ingestInboundMedia } = await import("./conversation.service");

    const res = await ingestInboundMedia({ ...audioInput, audioSeconds: 600 });

    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(res).toEqual({ respond: false, leadId: "lead-1", delayMs: 0 });

    const createArg = (prisma.message.create as any).mock.calls[0][0];
    expect(createArg.data.content).toBe("🎤 Áudio"); // placeholder mantido
    expect(createArg.data.mediaPath).toBe("leads/lead-1/audio.ogg"); // player continua
  });
});
