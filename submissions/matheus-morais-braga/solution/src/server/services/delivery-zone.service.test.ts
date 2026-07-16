import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import {
  listZones,
  createZone,
  updateZone,
  deleteZone,
  resolveZoneFee,
} from "./delivery-zone.service";

async function makeOwner(name = "Dono") {
  const u = await prisma.user.create({
    data: {
      email: `dzone_${Math.round(performance.now())}_${Math.random()}@t.test`,
      name,
      passwordHash: "x",
    },
  });
  return u.id;
}

describe("delivery-zone.service", () => {
  it("cria, lista (só ativas por padrão) e resolve taxa por id", async () => {
    const acc = await makeOwner();
    const z = await createZone(acc, { name: "Centro", feeCents: 500 });
    expect(z.feeCents).toBe(500);
    expect(z.active).toBe(true);

    const list = await listZones(acc);
    expect(list.map((x) => x.name)).toContain("Centro");

    const fee = await resolveZoneFee(acc, z.id);
    expect(fee).toMatchObject({ zoneId: z.id, feeCents: 500 });
  });

  it("resolveZoneFee rejeita zona de outra conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const z = await createZone(a, { name: "X", feeCents: 100 });
    await expect(resolveZoneFee(b, z.id)).rejects.toThrow();
  });

  it("zona inativa não aparece na listagem pública, mas aparece com includeInactive", async () => {
    const acc = await makeOwner();
    const z = await createZone(acc, { name: "Y", feeCents: 100 });
    await updateZone(acc, z.id, { active: false });
    expect((await listZones(acc)).find((x) => x.id === z.id)).toBeUndefined();
    expect((await listZones(acc, { includeInactive: true })).find((x) => x.id === z.id)).toBeDefined();
  });

  it("resolveZoneFee rejeita zona inativa", async () => {
    const acc = await makeOwner();
    const z = await createZone(acc, { name: "Z", feeCents: 100 });
    await updateZone(acc, z.id, { active: false });
    await expect(resolveZoneFee(acc, z.id)).rejects.toThrow();
  });

  it("createZone clampa taxa negativa e rejeita nome vazio", async () => {
    const acc = await makeOwner();
    const z = await createZone(acc, { name: "Bairro Novo", feeCents: -50 });
    expect(z.feeCents).toBe(0);
    await expect(createZone(acc, { name: "   ", feeCents: 0 })).rejects.toThrow();
  });

  it("createZone aceita pedido mínimo opcional", async () => {
    const acc = await makeOwner();
    const z = await createZone(acc, { name: "Longe", feeCents: 1200, minOrderCents: 3000 });
    expect(z.minOrderCents).toBe(3000);
    const fee = await resolveZoneFee(acc, z.id);
    expect(fee.minOrderCents).toBe(3000);
  });

  it("updateZone é tenant-safe (rejeita zona de outra conta)", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const z = await createZone(a, { name: "A", feeCents: 100 });
    await expect(updateZone(b, z.id, { name: "Hack" })).rejects.toThrow();
  });

  it("updateZone altera nome, taxa e pedido mínimo", async () => {
    const acc = await makeOwner();
    const z = await createZone(acc, { name: "Velho", feeCents: 100 });
    const u = await updateZone(acc, z.id, { name: "Novo Nome", feeCents: 800, minOrderCents: 1500 });
    expect(u).toMatchObject({ name: "Novo Nome", feeCents: 800, minOrderCents: 1500 });
  });

  it("deleteZone remove e é tenant-safe", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const z = await createZone(acc, { name: "Sumir", feeCents: 100 });
    await expect(deleteZone(other, z.id)).rejects.toThrow();
    await deleteZone(acc, z.id);
    expect((await listZones(acc, { includeInactive: true })).find((x) => x.id === z.id)).toBeUndefined();
  });

  it("listZones ordena por nome asc", async () => {
    const acc = await makeOwner();
    await createZone(acc, { name: "Zebra", feeCents: 0 });
    await createZone(acc, { name: "Alfa", feeCents: 0 });
    const list = await listZones(acc);
    const names = list.map((z) => z.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});
