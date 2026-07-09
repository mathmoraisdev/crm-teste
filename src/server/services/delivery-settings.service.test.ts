import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { getDeliverySettings, updateDeliverySettings } from "./delivery-settings.service";

async function makeOwner(name = "Dono") {
  const u = await prisma.user.create({
    data: {
      email: `dset_${Math.round(performance.now())}_${Math.random()}@t.test`,
      name,
      passwordHash: "x",
    },
  });
  return u.id;
}

describe("delivery-settings.service", () => {
  it("getDeliverySettings devolve defaults quando não há linha", async () => {
    const acc = await makeOwner();
    const s = await getDeliverySettings(acc);
    expect(s).toMatchObject({
      deliveryEnabled: true,
      pickupEnabled: true,
      payOnlineEnabled: true,
      payOnDeliveryEnabled: true,
      minOrderCents: 0,
      defaultPrepMinutes: 30,
      hours: null,
    });
  });

  it("updateDeliverySettings faz upsert e clampa negativos", async () => {
    const acc = await makeOwner();
    const s = await updateDeliverySettings(acc, {
      minOrderCents: -5,
      defaultPrepMinutes: 45,
      pickupEnabled: false,
    });
    expect(s.minOrderCents).toBe(0);
    expect(s.defaultPrepMinutes).toBe(45);
    expect(s.pickupEnabled).toBe(false);
  });

  it("updateDeliverySettings persiste e releitura bate", async () => {
    const acc = await makeOwner();
    await updateDeliverySettings(acc, {
      deliveryEnabled: false,
      minOrderCents: 2500,
      defaultPrepMinutes: 20,
    });
    const s = await getDeliverySettings(acc);
    expect(s).toMatchObject({
      deliveryEnabled: false,
      minOrderCents: 2500,
      defaultPrepMinutes: 20,
      pickupEnabled: true,
    });
  });

  it("updateDeliverySettings grava e lê hours (JSON)", async () => {
    const acc = await makeOwner();
    const hours = { "1": [{ open: "18:00", close: "23:00" }] };
    await updateDeliverySettings(acc, { hours });
    const s = await getDeliverySettings(acc);
    expect(s.hours).toEqual(hours);
  });

  it("updateDeliverySettings patch parcial não zera demais campos", async () => {
    const acc = await makeOwner();
    await updateDeliverySettings(acc, { minOrderCents: 1000, defaultPrepMinutes: 40 });
    // segundo upsert só mexe num campo
    const s = await updateDeliverySettings(acc, { pickupEnabled: false });
    expect(s.minOrderCents).toBe(1000);
    expect(s.defaultPrepMinutes).toBe(40);
    expect(s.pickupEnabled).toBe(false);
  });

  it("updateDeliverySettings clampa defaultPrepMinutes negativo", async () => {
    const acc = await makeOwner();
    const s = await updateDeliverySettings(acc, { defaultPrepMinutes: -3 });
    expect(s.defaultPrepMinutes).toBe(0);
  });
});
