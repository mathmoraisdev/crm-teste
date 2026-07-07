import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";
});

// env fixo: TZ e APP_URL são lidos no carregamento do módulo (const TZ, link público).
vi.mock("@/lib/env", () => ({
  env: { SCHEDULING_TIMEZONE: "America/Sao_Paulo", APP_URL: "https://app.test" },
}));
vi.mock("@/server/db/client", () => ({
  prisma: {
    lead: { findUnique: vi.fn() },
    meeting: { upsert: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    whatsAppNumber: { findUnique: vi.fn() },
  },
}));
vi.mock("./booking-availability.service", () => ({
  listBookableServices: vi.fn(),
  getAvailableSlots: vi.fn(),
  confirmBooking: vi.fn(),
}));
vi.mock("./messaging", () => ({ sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/ai/conversation.agent", () => ({ interpretSlotChoice: vi.fn() }));
vi.mock("@/server/ai/resolve", () => ({ getAiClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/server/services/entitlements", () => ({
  resolveAiModelForUser: vi.fn().mockResolvedValue(null),
}));

async function mods() {
  return {
    prisma: (await import("@/server/db/client")).prisma as any,
    listBookableServices: (await import("./booking-availability.service")).listBookableServices as any,
    getAvailableSlots: (await import("./booking-availability.service")).getAvailableSlots as any,
    confirmBooking: (await import("./booking-availability.service")).confirmBooking as any,
    send: (await import("./messaging")).sendWhatsAppMessage as any,
    interpretSlotChoice: (await import("@/server/ai/conversation.agent")).interpretSlotChoice as any,
  };
}

const LEAD = { id: "lead_1", name: "João Silva", phone: "+5511999", userId: "acc_1", whatsAppNumberId: "num_1" };
const SVC = { id: "svc_1", name: "Corte", priceCents: 5000, durationMinutes: 30 };
const slot = (over: Record<string, unknown> = {}) => ({
  startISO: "2026-07-10T13:00:00.000Z",
  professionalId: "pro_1",
  professionalName: "Ana",
  ...over,
});
const apptSlot = (over: Record<string, unknown> = {}) => ({
  startISO: "2026-07-10T13:00:00.000Z",
  professionalId: "pro_1",
  professionalName: "Ana",
  serviceId: "svc_1",
  serviceName: "Corte",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isAppointmentSlots (discriminador)", () => {
  it("objetos com startISO → true; strings ISO (fluxo antigo) → false", async () => {
    const { isAppointmentSlots } = await import("./appointment-chat.service");
    expect(isAppointmentSlots([apptSlot()])).toBe(true);
    expect(isAppointmentSlots(["2026-07-10T13:00:00.000Z"])).toBe(false);
    expect(isAppointmentSlots([])).toBe(false);
    expect(isAppointmentSlots(null)).toBe(false);
  });
});

describe("proposeAppointmentSlots", () => {
  it("pega os 3 primeiros livres, grava a proposta (objetos) e envia numerado", async () => {
    const m = await mods();
    m.prisma.lead.findUnique.mockResolvedValue(LEAD);
    m.listBookableServices.mockResolvedValue([SVC]);
    m.getAvailableSlots.mockResolvedValue([
      slot({ startISO: "2026-07-10T13:00:00.000Z" }),
      slot({ startISO: "2026-07-10T14:00:00.000Z", professionalName: "Bia", professionalId: "pro_2" }),
      slot({ startISO: "2026-07-10T15:00:00.000Z" }),
      slot({ startISO: "2026-07-10T16:00:00.000Z" }), // 4º é descartado
    ]);
    m.prisma.meeting.upsert.mockResolvedValue({});

    const { proposeAppointmentSlots } = await import("./appointment-chat.service");
    await proposeAppointmentSlots("lead_1", "acc_1", { serviceId: "svc_1", professionalId: "pro_1" });

    expect(m.getAvailableSlots).toHaveBeenCalledWith(
      "acc_1",
      expect.objectContaining({ catalogItemId: "svc_1", professionalId: "pro_1" }),
    );
    const upsertArg = m.prisma.meeting.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ leadId: "lead_1" });
    expect(upsertArg.create.status).toBe("PROPOSED");
    expect(upsertArg.create.proposedSlots).toHaveLength(3);
    expect(upsertArg.create.proposedSlots[0]).toMatchObject({
      startISO: "2026-07-10T13:00:00.000Z",
      professionalId: "pro_1",
      serviceId: "svc_1",
      serviceName: "Corte",
    });
    const [, texto] = m.send.mock.calls[0];
    expect(texto).toContain("1)");
    expect(texto).toContain("2)");
    expect(texto).toContain("3)");
    expect(texto).toContain("Corte");
  });

  it("sem preferência → professionalId null ao motor", async () => {
    const m = await mods();
    m.prisma.lead.findUnique.mockResolvedValue(LEAD);
    m.listBookableServices.mockResolvedValue([SVC]);
    m.getAvailableSlots.mockResolvedValue([slot()]);
    m.prisma.meeting.upsert.mockResolvedValue({});

    const { proposeAppointmentSlots } = await import("./appointment-chat.service");
    await proposeAppointmentSlots("lead_1", "acc_1", { serviceId: "svc_1" });

    expect(m.getAvailableSlots).toHaveBeenCalledWith(
      "acc_1",
      expect.objectContaining({ professionalId: null }),
    );
  });

  it("0 horários → fallback com link, NÃO grava proposta", async () => {
    const m = await mods();
    m.prisma.lead.findUnique.mockResolvedValue(LEAD);
    m.listBookableServices.mockResolvedValue([SVC]);
    m.getAvailableSlots.mockResolvedValue([]);
    m.prisma.user.findUnique.mockResolvedValue({ publicSlug: "corte-fino", bookingEnabled: true });

    const { proposeAppointmentSlots } = await import("./appointment-chat.service");
    await proposeAppointmentSlots("lead_1", "acc_1", { serviceId: "svc_1" });

    expect(m.prisma.meeting.upsert).not.toHaveBeenCalled();
    const [, texto] = m.send.mock.calls[0];
    expect(texto).toContain("https://app.test/agendar/corte-fino");
  });

  it("serviço inválido → avisa e NÃO consulta disponibilidade", async () => {
    const m = await mods();
    m.prisma.lead.findUnique.mockResolvedValue(LEAD);
    m.listBookableServices.mockResolvedValue([]); // serviço não encontrado

    const { proposeAppointmentSlots } = await import("./appointment-chat.service");
    await proposeAppointmentSlots("lead_1", "acc_1", { serviceId: "xxx" });

    expect(m.getAvailableSlots).not.toHaveBeenCalled();
    expect(m.prisma.meeting.upsert).not.toHaveBeenCalled();
    expect(m.send).toHaveBeenCalledTimes(1);
  });
});

describe("interpretAndBookAppointment", () => {
  function proposedLead() {
    return {
      ...LEAD,
      meeting: { status: "PROPOSED", proposedSlots: [apptSlot(), apptSlot({ startISO: "2026-07-10T14:00:00.000Z" })] },
    };
  }

  it("escolha confiante → confirmBooking + Meeting CONFIRMED, sem mensagem duplicada", async () => {
    const m = await mods();
    m.prisma.lead.findUnique.mockResolvedValue(proposedLead());
    m.prisma.whatsAppNumber.findUnique.mockResolvedValue({ aiModel: null });
    m.interpretSlotChoice.mockResolvedValue({ chosenIndex: 0, confident: true });
    m.confirmBooking.mockResolvedValue({ appointmentId: "ap_1", leadId: "lead_1", isWalkIn: false });
    m.prisma.meeting.update.mockResolvedValue({});

    const { interpretAndBookAppointment } = await import("./appointment-chat.service");
    const r = await interpretAndBookAppointment("lead_1", "o primeiro");

    expect(m.confirmBooking).toHaveBeenCalledWith("acc_1", {
      catalogItemId: "svc_1",
      professionalId: "pro_1",
      startISO: "2026-07-10T13:00:00.000Z",
      customerName: "João Silva",
      customerPhone: "+5511999",
    });
    expect(m.prisma.meeting.update).toHaveBeenCalledWith({
      where: { leadId: "lead_1" },
      data: { status: "CONFIRMED" },
    });
    expect(m.send).not.toHaveBeenCalled(); // confirmBooking já confirma ao lead
    expect(r).toEqual({ booked: true });
  });

  it("não confiante → pede reconfirmar, sem confirmar", async () => {
    const m = await mods();
    m.prisma.lead.findUnique.mockResolvedValue(proposedLead());
    m.prisma.whatsAppNumber.findUnique.mockResolvedValue({ aiModel: null });
    m.interpretSlotChoice.mockResolvedValue({ chosenIndex: null, confident: false });

    const { interpretAndBookAppointment } = await import("./appointment-chat.service");
    const r = await interpretAndBookAppointment("lead_1", "sei lá");

    expect(m.confirmBooking).not.toHaveBeenCalled();
    expect(m.prisma.meeting.update).not.toHaveBeenCalled();
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ booked: false });
  });

  it("CONFLICT → repropõe horários frescos, sem CONFIRMED", async () => {
    const m = await mods();
    m.prisma.lead.findUnique.mockResolvedValue(proposedLead());
    m.prisma.whatsAppNumber.findUnique.mockResolvedValue({ aiModel: null });
    m.interpretSlotChoice.mockResolvedValue({ chosenIndex: 0, confident: true });
    m.confirmBooking.mockRejectedValue(new Error("CONFLICT: Esse horário acabou de ser preenchido."));
    // repropose usa estes:
    m.listBookableServices.mockResolvedValue([SVC]);
    m.getAvailableSlots.mockResolvedValue([slot({ startISO: "2026-07-11T13:00:00.000Z" })]);
    m.prisma.meeting.upsert.mockResolvedValue({});

    const { interpretAndBookAppointment } = await import("./appointment-chat.service");
    const r = await interpretAndBookAppointment("lead_1", "o primeiro");

    expect(m.prisma.meeting.update).not.toHaveBeenCalled(); // não confirmou
    expect(m.getAvailableSlots).toHaveBeenCalled(); // reproposta buscou de novo
    expect(m.prisma.meeting.upsert).toHaveBeenCalled();
    expect(r).toEqual({ booked: false });
  });

  it("Meeting com slots-string (fluxo antigo) → não age (retorna booked:false)", async () => {
    const m = await mods();
    m.prisma.lead.findUnique.mockResolvedValue({
      ...LEAD,
      meeting: { status: "PROPOSED", proposedSlots: ["2026-07-10T13:00:00.000Z"] },
    });

    const { interpretAndBookAppointment } = await import("./appointment-chat.service");
    const r = await interpretAndBookAppointment("lead_1", "o primeiro");

    expect(m.interpretSlotChoice).not.toHaveBeenCalled();
    expect(m.confirmBooking).not.toHaveBeenCalled();
    expect(r).toEqual({ booked: false });
  });
});
