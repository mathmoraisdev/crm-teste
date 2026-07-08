import { describe, it, expect, vi, beforeEach } from "vitest";

// env.ts exige DATABASE_URL.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

vi.mock("@/server/db/client", () => ({
  prisma: {
    message: {
      findFirst: vi.fn(async () => null), // dedupe (por lead): nada existente
      create: vi.fn(async () => ({ id: "msg-1" })),
    },
    lead: {
      findFirst: vi.fn(async () => ({
        id: "lead-1",
        userId: "user-1",
        phone: "+5511999999999",
        whatsAppNumberId: "num-1",
        aiPaused: false,
        queuedAt: null,
        firstResponseAt: null,
        attendanceStatus: "IA",
      })),
      update: vi.fn(async () => ({})),
    },
    whatsAppNumber: {
      findUnique: vi.fn(async () => ({ autoPauseOnHumanReply: true })),
    },
  },
}));

vi.mock("@/server/storage/media-storage", () => ({
  uploadInboundMedia: vi.fn(async () => "lead-1/out-abc.jpg"),
}));

vi.mock("@/server/cache/keys", () => ({
  cacheKeys: { conversation: (id: string) => `conv:${id}` },
  invalidateConversation: vi.fn(async () => {}),
  invalidateLeadCaches: vi.fn(async () => {}),
}));

vi.mock("@/server/services/account.service", () => ({
  isAccountActiveByLead: vi.fn(async () => true),
}));

const imgInput = {
  toPhone: "+5511999999999",
  placeholder: "📷 Imagem",
  providerMessageId: "prov-out-1",
  whatsAppNumberId: "num-1",
  buffer: Buffer.from("fake-jpg"),
  mediaType: "image" as const,
  mime: "image/jpeg",
  fileName: "imagem.jpg",
};

describe("handleOperatorMedia — arquivo enviado pelo operador (fromMe)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("imagem baixável: grava OUTBOUND com anexo (source OPERATOR) e auto-pausa a IA", async () => {
    const { prisma } = await import("@/server/db/client");
    const { handleOperatorMedia } = await import("./conversation.service");

    const res = await handleOperatorMedia(imgInput);

    expect(res).toEqual({ leadId: "lead-1" });

    const arg = (prisma.message.create as any).mock.calls[0][0];
    expect(arg.data.direction).toBe("OUTBOUND");
    expect(arg.data.source).toBe("OPERATOR");
    expect(arg.data.content).toBe("📷 Imagem"); // placeholder p/ a bolha
    expect(arg.data.mediaPath).toBe("lead-1/out-abc.jpg");
    expect(arg.data.mediaType).toBe("image");
    expect(arg.data.mediaMime).toBe("image/jpeg");

    // autoPauseOnHumanReply=true → handoff automático (IA pausa).
    const updateArg = (prisma.lead.update as any).mock.calls[0][0];
    expect(updateArg.data.aiPaused).toBe(true);
  });

  it("imagem COM legenda: grava content=legenda (não o placeholder)", async () => {
    const { prisma } = await import("@/server/db/client");
    const { handleOperatorMedia } = await import("./conversation.service");

    await handleOperatorMedia({ ...imgInput, caption: "segue o contrato" });

    const arg = (prisma.message.create as any).mock.calls[0][0];
    expect(arg.data.content).toBe("segue o contrato");
    expect(arg.data.mediaPath).toBe("lead-1/out-abc.jpg");
  });

  it("dedupe: providerMessageId já gravado (eco do próprio envio) → não cria Message", async () => {
    const { prisma } = await import("@/server/db/client");
    (prisma.message.findFirst as any).mockResolvedValueOnce({ id: "msg-existing" });
    const { handleOperatorMedia } = await import("./conversation.service");

    const res = await handleOperatorMedia(imgInput);

    expect(res).toEqual({ leadId: "lead-1" });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("tipo não baixável (sem buffer): grava OUTBOUND só com placeholder, sem mediaPath", async () => {
    const { prisma } = await import("@/server/db/client");
    const { uploadInboundMedia } = await import("@/server/storage/media-storage");
    const { handleOperatorMedia } = await import("./conversation.service");

    const res = await handleOperatorMedia({
      toPhone: "+5511999999999",
      placeholder: "🎥 Vídeo",
      providerMessageId: "prov-out-2",
      whatsAppNumberId: "num-1",
      // sem buffer/mediaType → não baixamos esse tipo
    });

    expect(res).toEqual({ leadId: "lead-1" });
    expect(uploadInboundMedia).not.toHaveBeenCalled();

    const arg = (prisma.message.create as any).mock.calls[0][0];
    expect(arg.data.direction).toBe("OUTBOUND");
    expect(arg.data.content).toBe("🎥 Vídeo");
    expect(arg.data.mediaPath).toBeUndefined();
  });
});
