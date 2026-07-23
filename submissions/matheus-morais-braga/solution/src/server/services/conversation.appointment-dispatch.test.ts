import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

// Controla a forma de proposedSlots por teste (objeto = Agenda Pro; string = fluxo antigo).
const state = { proposedSlots: [] as unknown };

vi.mock("@/server/db/client", () => {
  const fullLead = () => ({
    id: "lead_1",
    status: "EM_CONVERSA",
    aiPaused: false,
    aiPausedAt: null,
    whatsAppNumberId: "num_1",
    userId: "acc_1",
    phone: "5511999",
    name: "João",
    queuedAt: null,
  });
  return {
    prisma: {
      lead: {
        findUnique: vi.fn((args: { select?: { aiPaused?: boolean } }) =>
          Promise.resolve(args?.select?.aiPaused ? { aiPaused: false } : fullLead()),
        ),
        update: vi.fn(() => Promise.resolve({})),
      },
      meeting: {
        findUnique: vi.fn(() =>
          Promise.resolve({ status: "PROPOSED", proposedSlots: state.proposedSlots }),
        ),
      },
      message: {
        findFirst: vi.fn(() => Promise.resolve({ content: "o primeiro" })),
      },
    },
  };
});

vi.mock("@/server/cache/cache", () => ({
  cached: (_k: string, _ttl: number, fn: () => unknown) => fn(),
}));
vi.mock("@/server/cache/keys", () => ({
  cacheKeys: { conversation: () => "k" },
  invalidateConversation: vi.fn(),
  invalidateLeadCaches: vi.fn(),
}));
vi.mock("@/server/ai/resolve", () => ({ getAiClient: vi.fn(() => Promise.resolve({})) }));
vi.mock("@/server/services/entitlements", () => ({
  consumeAiCredit: vi.fn(() => Promise.resolve({ allowed: true })),
  resolveAiModelForUser: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/server/services/messaging", () => ({
  sendWhatsAppMessage: vi.fn(() => Promise.resolve()),
  enqueueManualReply: vi.fn(),
  sendWhatsAppMedia: vi.fn(),
  enqueueManualMedia: vi.fn(),
}));
// Fluxo antigo (reunião de venda) — mock total.
vi.mock("./scheduling.service", () => ({
  interpretAndBook: vi.fn(() => Promise.resolve({ booked: false })),
  proposeSlots: vi.fn(),
}));
// Agenda Pro in-chat — espia o handler; reimplementa o discriminador (função pura
// trivial) p/ não carregar o módulo real (env não resolvido durante o hoist do mock).
vi.mock("./appointment-chat.service", () => ({
  isAppointmentSlots: (slots: unknown): boolean =>
    Array.isArray(slots) &&
    slots.length > 0 &&
    typeof slots[0] === "object" &&
    slots[0] !== null &&
    "startISO" in (slots[0] as object),
  interpretAndBookAppointment: vi.fn(() => Promise.resolve({ booked: false })),
}));

import { interpretAndBook } from "./scheduling.service";
import { interpretAndBookAppointment } from "./appointment-chat.service";
const interpretAndBookMock = vi.mocked(interpretAndBook);
const interpretApptMock = vi.mocked(interpretAndBookAppointment);

beforeEach(() => vi.clearAllMocks());

describe("respondToLead — dispatch da proposta PROPOSED por forma", () => {
  it("proposedSlots em OBJETO → rota nova (interpretAndBookAppointment)", async () => {
    state.proposedSlots = [
      { startISO: "2026-07-10T13:00:00.000Z", professionalId: "pro_1", professionalName: "Ana", serviceId: "svc_1", serviceName: "Corte" },
    ];
    const { respondToLead } = await import("./conversation.service");
    await respondToLead("lead_1");
    expect(interpretApptMock).toHaveBeenCalledWith("lead_1", "o primeiro");
    expect(interpretAndBookMock).not.toHaveBeenCalled();
  });

  it("proposedSlots em STRING → rota antiga (interpretAndBook)", async () => {
    state.proposedSlots = ["2026-07-10T13:00:00.000Z"];
    const { respondToLead } = await import("./conversation.service");
    await respondToLead("lead_1");
    expect(interpretAndBookMock).toHaveBeenCalledWith("lead_1", "o primeiro");
    expect(interpretApptMock).not.toHaveBeenCalled();
  });
});
