import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/server/db/client";

vi.mock("@/server/storage/media-storage", () => ({
  uploadInboundMedia: vi.fn(async () => "acct/uuid-1.jpg"),
  removeMediaObjects: vi.fn(async () => true),
  downloadMediaBuffer: vi.fn(async () => Buffer.from("x")),
  createMediaSignedUrl: vi.fn(async () => "https://signed.example/x"),
}));

import {
  addCatalogItemPhoto,
  listCatalogItemPhotos,
  deleteCatalogItemPhoto,
  reorderCatalogItemPhotos,
} from "@/server/services/catalog-photo.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `cph_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}
async function makeItem(accountId: string) {
  const it = await prisma.catalogItem.create({
    data: { accountId, name: "Carro", priceCents: 100, kind: "PRODUTO" },
  });
  return it.id;
}

describe("catalog-photo.service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adiciona foto e lista em ordem", async () => {
    const a = await makeOwner();
    const item = await makeItem(a);
    const p1 = await addCatalogItemPhoto(a, item, { buffer: Buffer.from("a"), mime: "image/jpeg" });
    const p2 = await addCatalogItemPhoto(a, item, { buffer: Buffer.from("b"), mime: "image/png" });
    expect(p1.order).toBe(0);
    expect(p2.order).toBe(1);
    const list = await listCatalogItemPhotos(a, item);
    expect(list.map((p) => p.id)).toEqual([p1.id, p2.id]);
  });

  it("rejeita mime não-imagem", async () => {
    const a = await makeOwner();
    const item = await makeItem(a);
    await expect(
      addCatalogItemPhoto(a, item, { buffer: Buffer.from("a"), mime: "application/pdf" }),
    ).rejects.toThrow();
  });

  it("não adiciona foto em item de outra conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const item = await makeItem(a);
    await expect(
      addCatalogItemPhoto(b, item, { buffer: Buffer.from("a"), mime: "image/jpeg" }),
    ).rejects.toThrow();
  });

  it("deleta foto (apaga do storage) e reordena", async () => {
    const a = await makeOwner();
    const item = await makeItem(a);
    const p1 = await addCatalogItemPhoto(a, item, { buffer: Buffer.from("a"), mime: "image/jpeg" });
    const p2 = await addCatalogItemPhoto(a, item, { buffer: Buffer.from("b"), mime: "image/jpeg" });
    await deleteCatalogItemPhoto(a, item, p1.id);
    await reorderCatalogItemPhotos(a, item, [p2.id]);
    const list = await listCatalogItemPhotos(a, item);
    expect(list.map((p) => p.id)).toEqual([p2.id]);
    expect(list[0].order).toBe(0);
  });
});
