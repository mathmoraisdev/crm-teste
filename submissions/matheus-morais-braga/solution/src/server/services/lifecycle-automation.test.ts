import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import {
  dispatchLifecycleAutomations,
  dispatchPostSale,
  dispatchReviewRequests,
  dispatchReengagement,
} from "./lifecycle-automation";

// Teste de INTEGRAÇÃO (banco de dev, modo mock — sem envio externo). Espelha o
// estilo de order.service.test.ts (prisma real). As envs LIFECYCLE_* são
// controladas mutando o objeto `env` exportado (ele é parseado uma única vez no
// import), com baseline restaurado a cada teste. Como os passes fazem varredura
// GLOBAL por conta, cada teste limpa os dados que criou (evita contaminação).

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date("2026-07-08T15:00:00.000Z"); // 12:00 em America/Sao_Paulo → dentro da janela 9..18

const e = env as unknown as Record<string, unknown>;
const ownerIds: string[] = [];
let phoneSeq = 0;

async function makeOwner(optIn: boolean): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `lc_${Math.round(performance.now())}_${Math.random()}@t.test`,
      name: "Dona",
      passwordHash: "x",
      lifecycleAutomationEnabled: optIn,
    },
  });
  ownerIds.push(u.id);
  return u.id;
}

async function makeLead(
  ownerId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string }> {
  return prisma.lead.create({
    data: {
      userId: ownerId,
      name: "Ana Paula",
      phone: `+55119${String(phoneSeq++).padStart(8, "0")}`,
      status: "NOVO",
      ...over,
    },
    select: { id: true },
  });
}

async function makeOrder(
  ownerId: string,
  leadId: string | null,
  closedAt: Date | null,
  over: Record<string, unknown> = {},
): Promise<{ id: string }> {
  return prisma.order.create({
    data: {
      accountId: ownerId,
      openedById: ownerId,
      status: "FECHADA",
      closedAt,
      leadId,
      ...over,
    },
    select: { id: true },
  });
}

async function inbound(leadId: string, createdAt: Date): Promise<void> {
  await prisma.message.create({
    data: { leadId, direction: "INBOUND", content: "oi", createdAt },
  });
}

beforeEach(() => {
  e.LIFECYCLE_AUTOMATION = false;
  e.LIFECYCLE_POSTSALE_HOURS = 0;
  e.LIFECYCLE_REVIEW_HOURS = 0;
  e.LIFECYCLE_REENGAGE_DAYS = 0;
  e.LIFECYCLE_BACKLOG_FLOOR_DAYS = 7;
  e.WHATSAPP_SEND_START_HOUR = 9;
  e.WHATSAPP_SEND_END_HOUR = 18;
  e.OUTBOUND_OPTOUT_FOOTER = true;
  e.OUTBOUND_OPTOUT_FOOTER_TEXT = "Responda SAIR para não receber mais mensagens.";
  e.WHATSAPP_MODE = "mock";
});

afterEach(async () => {
  if (ownerIds.length === 0) return;
  const where = { in: ownerIds };
  await prisma.message.deleteMany({ where: { lead: { userId: where } } });
  await prisma.order.deleteMany({ where: { accountId: where } });
  await prisma.lead.deleteMany({ where: { userId: where } });
  await prisma.user.deleteMany({ where: { id: where } });
  ownerIds.length = 0;
});

describe("dispatchLifecycleAutomations (kill-switch + janela)", () => {
  it("no-op quando o kill-switch global está off", async () => {
    e.LIFECYCLE_POSTSALE_HOURS = 2;
    const owner = await makeOwner(true);
    const lead = await makeLead(owner);
    const order = await makeOrder(owner, lead.id, new Date(now.getTime() - 3 * HOUR));
    // AUTOMATION=false → nem varre
    expect(await dispatchLifecycleAutomations(now)).toBe(0);
    const o = await prisma.order.findUnique({ where: { id: order.id } });
    expect(o?.postSaleThankedAt).toBeNull();
  });

  it("fora da janela comercial → 0 (espera; não marca)", async () => {
    e.LIFECYCLE_AUTOMATION = true;
    e.LIFECYCLE_POSTSALE_HOURS = 2;
    const owner = await makeOwner(true);
    const lead = await makeLead(owner);
    const order = await makeOrder(owner, lead.id, new Date(now.getTime() - 3 * HOUR));
    const madrugada = new Date("2026-07-08T05:00:00.000Z"); // 02:00 SP → fora de 9..18
    expect(await dispatchLifecycleAutomations(madrugada)).toBe(0);
    const o = await prisma.order.findUnique({ where: { id: order.id } });
    expect(o?.postSaleThankedAt).toBeNull();
  });

  it("dentro da janela + ligado dispara os passes (pós-venda)", async () => {
    e.LIFECYCLE_AUTOMATION = true;
    e.LIFECYCLE_POSTSALE_HOURS = 2;
    const owner = await makeOwner(true);
    const lead = await makeLead(owner);
    await makeOrder(owner, lead.id, new Date(now.getTime() - 3 * HOUR));
    expect(await dispatchLifecycleAutomations(now)).toBe(1);
  });
});

describe("dispatchPostSale", () => {
  it("comanda FECHADA há 3h (atraso 2h) → 1 envio + marca postSaleThankedAt + Message OUTBOUND", async () => {
    e.LIFECYCLE_POSTSALE_HOURS = 2;
    const owner = await makeOwner(true);
    const lead = await makeLead(owner, { name: "João Silva" });
    const order = await makeOrder(owner, lead.id, new Date(now.getTime() - 3 * HOUR));
    expect(await dispatchPostSale(now)).toBe(1);
    const o = await prisma.order.findUnique({ where: { id: order.id } });
    expect(o?.postSaleThankedAt).not.toBeNull();
    const msgs = await prisma.message.findMany({
      where: { leadId: lead.id, direction: "OUTBOUND", source: "SYSTEM" },
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("João"); // primeiro nome, sem rodapé de opt-out
    expect(msgs[0].content).not.toContain("SAIR");
  });

  it("não repete (idempotente entre ticks)", async () => {
    e.LIFECYCLE_POSTSALE_HOURS = 2;
    const owner = await makeOwner(true);
    const lead = await makeLead(owner);
    await makeOrder(owner, lead.id, new Date(now.getTime() - 3 * HOUR));
    expect(await dispatchPostSale(now)).toBe(1);
    expect(await dispatchPostSale(new Date(now.getTime() + 60_000))).toBe(0);
  });

  it("pula conta sem opt-in (lifecycleAutomationEnabled=false)", async () => {
    e.LIFECYCLE_POSTSALE_HOURS = 2;
    const owner = await makeOwner(false);
    const lead = await makeLead(owner);
    await makeOrder(owner, lead.id, new Date(now.getTime() - 3 * HOUR));
    expect(await dispatchPostSale(now)).toBe(0);
  });

  it("pula comanda avulsa (leadId null) e lead em opt-out", async () => {
    e.LIFECYCLE_POSTSALE_HOURS = 2;
    const owner = await makeOwner(true);
    await makeOrder(owner, null, new Date(now.getTime() - 3 * HOUR)); // avulsa
    const optOutLead = await makeLead(owner, { optOut: true });
    await makeOrder(owner, optOutLead.id, new Date(now.getTime() - 3 * HOUR));
    expect(await dispatchPostSale(now)).toBe(0);
  });

  it("respeita o piso anti-backlog (comanda de 10 dias, floor 7) → 0", async () => {
    e.LIFECYCLE_POSTSALE_HOURS = 2;
    const owner = await makeOwner(true);
    const lead = await makeLead(owner);
    await makeOrder(owner, lead.id, new Date(now.getTime() - 10 * DAY));
    expect(await dispatchPostSale(now)).toBe(0);
  });

  it("desligado (LIFECYCLE_POSTSALE_HOURS=0) → 0", async () => {
    const owner = await makeOwner(true);
    const lead = await makeLead(owner);
    await makeOrder(owner, lead.id, new Date(now.getTime() - 3 * HOUR));
    expect(await dispatchPostSale(now)).toBe(0);
  });
});

describe("dispatchReviewRequests", () => {
  it("é independente do pós-venda (mesma comanda, marcador reviewRequestedAt)", async () => {
    e.LIFECYCLE_POSTSALE_HOURS = 2;
    e.LIFECYCLE_REVIEW_HOURS = 24;
    const owner = await makeOwner(true);
    const lead = await makeLead(owner);
    // fechada há 25h: já venceu tanto o pós-venda (2h) quanto o NPS (24h)
    const order = await makeOrder(owner, lead.id, new Date(now.getTime() - 25 * HOUR));

    expect(await dispatchPostSale(now)).toBe(1);
    expect(await dispatchReviewRequests(now)).toBe(1); // NPS ainda sai (marcador distinto)
    const o = await prisma.order.findUnique({ where: { id: order.id } });
    expect(o?.postSaleThankedAt).not.toBeNull();
    expect(o?.reviewRequestedAt).not.toBeNull();
    const nps = await prisma.message.findMany({ where: { leadId: lead.id, direction: "OUTBOUND" } });
    expect(nps.some((m) => /0 a 10|recomend/i.test(m.content))).toBe(true);
  });
});

describe("dispatchReengagement", () => {
  it("lead com inbound há 10d e sem inbound recente → 1 envio + lastEngagedAt + rodapé", async () => {
    e.LIFECYCLE_REENGAGE_DAYS = 7;
    const owner = await makeOwner(true);
    const lead = await makeLead(owner, { name: "Zé", status: "EM_CONVERSA" });
    await inbound(lead.id, new Date(now.getTime() - 10 * DAY));

    expect(await dispatchReengagement(now)).toBe(1);
    const l = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(l?.lastEngagedAt).not.toBeNull();
    const out = await prisma.message.findFirst({
      where: { leadId: lead.id, direction: "OUTBOUND", source: "SYSTEM" },
    });
    expect(out?.content).toContain("Zé");
    expect(out?.content).toContain("SAIR"); // win-back é cold-ish → leva o rodapé
  });

  it("pula recente/opt-out/aiPaused/status errado/compra recente; toca só o frio", async () => {
    e.LIFECYCLE_REENGAGE_DAYS = 7;
    const owner = await makeOwner(true);

    const good = await makeLead(owner, { status: "EM_CONVERSA" });
    await inbound(good.id, new Date(now.getTime() - 10 * DAY));

    const recent = await makeLead(owner, { status: "EM_CONVERSA" });
    await inbound(recent.id, new Date(now.getTime() - 2 * DAY)); // inbound recente

    const optOut = await makeLead(owner, { status: "EM_CONVERSA", optOut: true });
    await inbound(optOut.id, new Date(now.getTime() - 10 * DAY));

    const paused = await makeLead(owner, { status: "EM_CONVERSA", aiPaused: true });
    await inbound(paused.id, new Date(now.getTime() - 10 * DAY));

    const pago = await makeLead(owner, { status: "PAGO" });
    await inbound(pago.id, new Date(now.getTime() - 10 * DAY));

    const bought = await makeLead(owner, { status: "EM_CONVERSA" });
    await inbound(bought.id, new Date(now.getTime() - 10 * DAY));
    await makeOrder(owner, bought.id, new Date(now.getTime() - 2 * DAY)); // comanda FECHADA recente

    expect(await dispatchReengagement(now)).toBe(1);
    const l = await prisma.lead.findUnique({ where: { id: good.id } });
    expect(l?.lastEngagedAt).not.toBeNull();
    // os demais permanecem intocados
    for (const other of [recent, optOut, paused, pago, bought]) {
      const o = await prisma.lead.findUnique({ where: { id: other.id } });
      expect(o?.lastEngagedAt).toBeNull();
    }
  });

  it("não re-toca frio recém-tocado (lastEngagedAt dentro do cutoff)", async () => {
    e.LIFECYCLE_REENGAGE_DAYS = 7;
    const owner = await makeOwner(true);
    const lead = await makeLead(owner, {
      status: "EM_CONVERSA",
      lastEngagedAt: new Date(now.getTime() - 2 * DAY), // tocado há 2d (< 7d)
    });
    await inbound(lead.id, new Date(now.getTime() - 10 * DAY));
    expect(await dispatchReengagement(now)).toBe(0);
  });
});
