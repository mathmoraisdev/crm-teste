import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * startCampaign agora ENFILEIRA (não dispara). Este teste garante que:
 *  - cria 1 OutboundJob por lead (renderizado, freeform no modo mock),
 *  - marca a campanha como RUNNING,
 *  - NÃO chama o WhatsApp (não há import de messaging aqui).
 * Prisma e env são mockados — sem banco, sem credenciais.
 */

// modo mock + sem template → jobs freeform
vi.mock("@/lib/env", () => ({
  env: {
    WHATSAPP_TEMPLATE_NAME: "",
    WHATSAPP_MODE: "mock",
    WHATSAPP_TEMPLATE_LANG: "pt_BR",
  },
}));

const findFirst = vi.fn();
const update = vi.fn();
const createMany = vi.fn();
const $transaction = vi.fn((ops: Promise<unknown>[]) => Promise.all(ops));

vi.mock("@/server/db/client", () => ({
  prisma: {
    campaign: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
    outboundJob: {
      createMany: (...a: unknown[]) => createMany(...a),
    },
    $transaction: (...a: unknown[]) => $transaction(...(a as [Promise<unknown>[]])),
  },
}));

import { startCampaign } from "./campaign.service";

describe("startCampaign (enfileiramento)", () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockReset().mockResolvedValue({});
    createMany.mockReset().mockResolvedValue({ count: 0 });
    $transaction.mockClear();
  });

  it("cria N OutboundJobs PENDING e marca a campanha como RUNNING (sem enviar)", async () => {
    findFirst.mockResolvedValue({
      id: "camp-1",
      messageTemplate: "Olá {{nome}}!",
      leads: [
        { id: "l1", name: "Ana" },
        { id: "l2", name: "Bruno" },
      ],
    });

    const result = await startCampaign("camp-1", "user-1");

    expect(result).toEqual({ enqueued: 2 });

    // marca a campanha como RUNNING
    expect(update).toHaveBeenCalledWith({
      where: { id: "camp-1" },
      data: { status: "RUNNING" },
    });

    // cria os jobs renderizados (freeform no mock, templateName null)
    expect(createMany).toHaveBeenCalledTimes(1);
    const arg = createMany.mock.calls[0][0] as { data: unknown[] };
    expect(arg.data).toEqual([
      { leadId: "l1", campaignId: "camp-1", kind: "freeform", content: "Olá Ana!", templateName: null },
      { leadId: "l2", campaignId: "camp-1", kind: "freeform", content: "Olá Bruno!", templateName: null },
    ]);
  });

  it("enfileira zero jobs quando não há leads NOVO elegíveis", async () => {
    findFirst.mockResolvedValue({
      id: "camp-2",
      messageTemplate: "Oi {{nome}}",
      leads: [],
    });

    const result = await startCampaign("camp-2", "user-1");

    expect(result).toEqual({ enqueued: 0 });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect((createMany.mock.calls[0][0] as { data: unknown[] }).data).toEqual([]);
  });

  it("lança quando a campanha não existe", async () => {
    findFirst.mockResolvedValue(null);
    await expect(startCampaign("nope", "user-1")).rejects.toThrow("Campanha não encontrada");
    expect(createMany).not.toHaveBeenCalled();
  });
});
