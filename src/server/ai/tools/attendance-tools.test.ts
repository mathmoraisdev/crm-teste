import { describe, it, expect, vi, beforeEach } from "vitest";

// Serviços stubados — as tools são testadas em isolamento (sem DB/WhatsApp real).
vi.mock("@/server/services/catalog.service", () => ({
  listCatalogItems: vi.fn(),
}));
vi.mock("@/server/services/messaging", () => ({
  sendWhatsAppMessage: vi.fn(),
}));

import { listCatalogItems } from "@/server/services/catalog.service";
import { sendWhatsAppMessage } from "@/server/services/messaging";
import { buildAttendanceTools, type AttendanceToolCtx } from "./attendance-tools";

const listMock = vi.mocked(listCatalogItems);
const sendMock = vi.mocked(sendWhatsAppMessage);

function ctx(over: Partial<AttendanceToolCtx> = {}): AttendanceToolCtx {
  return {
    lead: { id: "lead_1", phone: "5511999", userId: "acc_1", whatsAppNumberId: "num_1", name: "João" },
    accountId: "acc_1",
    company: { salesEnabled: false, scheduleEnabled: false, qualifyEnabled: false },
    hasCatalog: true,
    hasMedia: false,
    ...over,
  };
}

const item = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "ci_1", kind: "PRODUTO", name: "X-Burguer", priceCents: 2500, active: true,
  trackStock: true, sku: null, stockQty: 8, minStock: 0, costCents: null,
  printSector: null, durationMinutes: null, ...over,
}) as never;

function tool(name: string) {
  const t = buildAttendanceTools(ctx()).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} não registrada`);
  return t;
}

beforeEach(() => {
  listMock.mockReset();
  sendMock.mockReset();
});

describe("buildAttendanceTools (Fase 2)", () => {
  it("registra sempre consultar_estoque e enviar_catalogo", () => {
    const names = buildAttendanceTools(ctx()).map((t) => t.name);
    expect(names).toEqual(["consultar_estoque", "enviar_catalogo"]);
  });
});

describe("consultar_estoque", () => {
  it("devolve o render com id/preço/estoque e NÃO envia nada", async () => {
    listMock.mockResolvedValue([item()]);
    const r = await tool("consultar_estoque").handler({});
    expect(r.content).toContain("id=ci_1");
    expect(r.content).toContain("X-Burguer");
    expect(r.content).toContain("estoque=8");
    expect(r.stop).toBeFalsy();
    expect(sendMock).not.toHaveBeenCalled();
    expect(listMock).toHaveBeenCalledWith("acc_1", { activeOnly: true });
  });

  it("filtra por query (case-insensitive)", async () => {
    listMock.mockResolvedValue([item(), item({ id: "ci_2", name: "Coca-Cola", trackStock: false })]);
    const r = await tool("consultar_estoque").handler({ query: "coca" });
    expect(r.content).toContain("Coca-Cola");
    expect(r.content).not.toContain("X-Burguer");
  });

  it("query sem match → mensagem amigável", async () => {
    listMock.mockResolvedValue([item()]);
    const r = await tool("consultar_estoque").handler({ query: "pizza" });
    expect(r.content).toMatch(/Nenhum item/i);
  });
});

describe("enviar_catalogo", () => {
  it("envia o catálogo ao cliente uma vez (sem ids) e não usa stop", async () => {
    listMock.mockResolvedValue([item(), item({ id: "ci_2", name: "Coca", priceCents: 700 })]);
    const r = await tool("enviar_catalogo").handler({});
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [, texto] = sendMock.mock.calls[0];
    expect(texto).toContain("X-Burguer");
    expect(texto).toContain("R$ 25,00");
    expect(texto).not.toContain("id=");
    expect(r.content).toBe("catálogo enviado");
    expect(r.stop).toBeFalsy();
  });

  it("catálogo vazio → não envia e avisa", async () => {
    listMock.mockResolvedValue([]);
    const r = await tool("enviar_catalogo").handler({});
    expect(sendMock).not.toHaveBeenCalled();
    expect(r.content).toMatch(/vazio/i);
  });
});
