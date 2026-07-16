import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * startCampaign ENFILEIRA (não dispara) em LOTES, sem carregar todos os leads em
 * memória, e é IDEMPOTENTE (campanha em RUNNING não reenfileira). Este teste
 * garante que:
 *  - cria 1 OutboundJob por lead disparável (renderizado, freeform no mock),
 *  - marca a campanha como RUNNING antes de enfileirar,
 *  - pagina os leads via lead.findMany (lotes), não via include,
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

const campaignFindFirst = vi.fn();
const campaignUpdate = vi.fn();
const leadFindMany = vi.fn();
const createMany = vi.fn();

vi.mock("@/server/db/client", () => ({
  prisma: {
    campaign: {
      findFirst: (...a: unknown[]) => campaignFindFirst(...a),
      update: (...a: unknown[]) => campaignUpdate(...a),
    },
    lead: {
      findMany: (...a: unknown[]) => leadFindMany(...a),
    },
    outboundJob: {
      createMany: (...a: unknown[]) => createMany(...a),
    },
  },
}));

// Gate de entitlements é coberto em entitlements.test.ts; aqui vira no-op.
vi.mock("@/server/services/entitlements", () => ({ assertFeature: vi.fn() }));

import { startCampaign } from "./campaign.service";

/** Faz o lead.findMany devolver `leads` na 1ª página e [] depois (encerra o loop). */
function paginate(leads: { id: string; name: string }[]) {
  let served = false;
  leadFindMany.mockImplementation(() => {
    if (served) return Promise.resolve([]);
    served = true;
    return Promise.resolve(leads);
  });
}

describe("startCampaign (enfileiramento em lotes + idempotência)", () => {
  beforeEach(() => {
    campaignFindFirst.mockReset();
    campaignUpdate.mockReset().mockResolvedValue({});
    leadFindMany.mockReset();
    createMany.mockReset().mockImplementation((arg: { data: unknown[] }) =>
      Promise.resolve({ count: arg.data.length }),
    );
  });

  it("cria N OutboundJobs PENDING e marca a campanha como RUNNING (sem enviar)", async () => {
    campaignFindFirst.mockResolvedValue({
      id: "camp-1",
      status: "DRAFT",
      messageTemplate: "Olá {{nome}}!",
    });
    paginate([
      { id: "l1", name: "Ana" },
      { id: "l2", name: "Bruno" },
    ]);

    const result = await startCampaign("camp-1", "user-1");

    expect(result).toEqual({ enqueued: 2 });
    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp-1" },
      data: { status: "RUNNING" },
    });
    const arg = createMany.mock.calls[0][0] as { data: unknown[] };
    expect(arg.data).toEqual([
      { leadId: "l1", campaignId: "camp-1", kind: "freeform", content: "Olá Ana!", templateName: null },
      { leadId: "l2", campaignId: "camp-1", kind: "freeform", content: "Olá Bruno!", templateName: null },
    ]);
  });

  it("filtra leads disparáveis (NOVO e CONTATADO, não opt-out)", async () => {
    campaignFindFirst.mockResolvedValue({ id: "camp-3", status: "DRAFT", messageTemplate: "Oi {{nome}}" });
    paginate([{ id: "l1", name: "Ana" }]);

    await startCampaign("camp-3", "user-1");

    const arg = leadFindMany.mock.calls[0][0] as {
      where: { campaignId: string; status: { in: string[] }; optOut: boolean };
    };
    expect(arg.where.campaignId).toBe("camp-3");
    expect(arg.where.status.in).toEqual(["NOVO", "CONTATADO"]);
    expect(arg.where.optOut).toBe(false);
  });

  it("idempotência: campanha já RUNNING não reenfileira (enqueued 0, sem createMany)", async () => {
    campaignFindFirst.mockResolvedValue({ id: "camp-r", status: "RUNNING", messageTemplate: "Oi {{nome}}" });

    const result = await startCampaign("camp-r", "user-1");

    expect(result).toEqual({ enqueued: 0 });
    expect(campaignUpdate).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(leadFindMany).not.toHaveBeenCalled();
  });

  it("lança quando a campanha não existe", async () => {
    campaignFindFirst.mockResolvedValue(null);
    await expect(startCampaign("nope", "user-1")).rejects.toThrow("Campanha não encontrada");
    expect(createMany).not.toHaveBeenCalled();
  });
});
