import { describe, it, expect, vi, beforeEach } from "vitest";

// Serviços stubados — as tools são testadas em isolamento (sem DB/WhatsApp real).
vi.mock("@/server/services/catalog.service", () => ({
  listCatalogItems: vi.fn(),
}));
vi.mock("@/server/services/messaging", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/server/services/order.service", () => ({
  listOpenOrders: vi.fn(),
  openOrder: vi.fn(),
  addItem: vi.fn(),
}));

import { listCatalogItems } from "@/server/services/catalog.service";
import { sendWhatsAppMessage } from "@/server/services/messaging";
import { addItem, listOpenOrders, openOrder } from "@/server/services/order.service";
import { buildAttendanceTools, type AttendanceToolCtx } from "./attendance-tools";

const listMock = vi.mocked(listCatalogItems);
const sendMock = vi.mocked(sendWhatsAppMessage);
const listOpenMock = vi.mocked(listOpenOrders);
const openOrderMock = vi.mocked(openOrder);
const addItemMock = vi.mocked(addItem);

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
  listOpenMock.mockReset();
  openOrderMock.mockReset();
  addItemMock.mockReset();
});

// OrderDTO mínimo p/ os stubs de comanda.
const orderDto = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "ord_1", status: "ABERTA", leadId: "lead_1", customerName: null, payment: null,
  note: null, createdAt: "", closedAt: null, customFields: null, discountCents: null,
  surchargeCents: null, tipCents: null, amountTenderedCents: null, changeCents: null,
  tableLabel: null, items: [], subtotalCents: 0, totalCents: 0, ...over,
}) as never;

describe("buildAttendanceTools (gating)", () => {
  it("registra sempre consultar_estoque e enviar_catalogo", () => {
    const names = buildAttendanceTools(ctx({ hasCatalog: false })).map((t) => t.name);
    expect(names).toEqual(["consultar_estoque", "enviar_catalogo"]);
  });

  it("registra criar_comanda só quando hasCatalog", () => {
    expect(buildAttendanceTools(ctx({ hasCatalog: true })).map((t) => t.name)).toContain("criar_comanda");
    expect(buildAttendanceTools(ctx({ hasCatalog: false })).map((t) => t.name)).not.toContain("criar_comanda");
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

describe("criar_comanda", () => {
  it("lead SEM comanda → abre 1 e adiciona os itens; resumo com o total", async () => {
    listOpenMock.mockResolvedValue([]);
    openOrderMock.mockResolvedValue(orderDto());
    addItemMock
      .mockResolvedValueOnce(orderDto({ items: [{ id: "i1", nameSnapshot: "X-Burguer", unitPriceCents: 2500, quantity: 2, catalogItemId: "ci_1", customFields: null }], totalCents: 5000 }))
      .mockResolvedValueOnce(orderDto({
        items: [
          { id: "i1", nameSnapshot: "X-Burguer", unitPriceCents: 2500, quantity: 2, catalogItemId: "ci_1", customFields: null },
          { id: "i2", nameSnapshot: "Coca", unitPriceCents: 700, quantity: 1, catalogItemId: "ci_2", customFields: null },
        ],
        totalCents: 5700,
      }));
    const r = await tool("criar_comanda").handler({
      itens: [{ catalogItemId: "ci_1", quantidade: 2 }, { catalogItemId: "ci_2" }],
    });
    expect(openOrderMock).toHaveBeenCalledTimes(1);
    expect(openOrderMock).toHaveBeenCalledWith("acc_1", { openedById: "acc_1", leadId: "lead_1" });
    expect(addItemMock).toHaveBeenCalledTimes(2);
    expect(addItemMock).toHaveBeenNthCalledWith(1, "acc_1", "ord_1", { catalogItemId: "ci_1", quantity: 2 });
    expect(r.content).toContain("2× X-Burguer");
    expect(r.content).toContain("1× Coca");
    expect(r.content).toContain("R$ 57,00");
    expect(r.stop).toBeFalsy();
  });

  it("lead COM comanda aberta → reusa (0 openOrder), itens vão na existente", async () => {
    listOpenMock.mockResolvedValue([orderDto({ id: "ord_9", leadId: "lead_1" })]);
    addItemMock.mockResolvedValue(orderDto({ id: "ord_9", items: [{ id: "i1", nameSnapshot: "Coxinha", unitPriceCents: 600, quantity: 3, catalogItemId: "ci_3", customFields: null }], totalCents: 1800 }));
    const r = await tool("criar_comanda").handler({ itens: [{ catalogItemId: "ci_3", quantidade: 3 }] });
    expect(openOrderMock).not.toHaveBeenCalled();
    expect(addItemMock).toHaveBeenCalledWith("acc_1", "ord_9", { catalogItemId: "ci_3", quantity: 3 });
    expect(r.content).toMatch(/atualizada/i);
    expect(r.content).toContain("3× Coxinha");
  });

  it("id inválido → mensagem de erro amigável, sem crash", async () => {
    listOpenMock.mockResolvedValue([]);
    openOrderMock.mockResolvedValue(orderDto());
    addItemMock.mockRejectedValue(new Error("Item do catálogo não encontrado."));
    const r = await tool("criar_comanda").handler({ itens: [{ catalogItemId: "xxx" }] });
    expect(r.content).toMatch(/não encontrei|não consegui/i);
    expect(r.content).toContain("xxx");
  });

  it("sem itens → avisa sem tocar no order.service", async () => {
    const r = await tool("criar_comanda").handler({ itens: [] });
    expect(listOpenMock).not.toHaveBeenCalled();
    expect(r.content).toMatch(/nenhum item/i);
  });
});
