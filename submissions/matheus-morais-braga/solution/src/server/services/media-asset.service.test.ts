import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public";

vi.mock("@/server/db/client", () => ({
  prisma: {
    mediaAsset: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock("@/server/storage/media-storage", () => ({
  uploadInboundMedia: vi.fn(),
  removeMediaObjects: vi.fn(),
}));

import { prisma } from "@/server/db/client";
import { uploadInboundMedia, removeMediaObjects } from "@/server/storage/media-storage";
import { listMediaAssets, createMediaAsset, deleteMediaAsset } from "./media-asset.service";

const createMock = vi.mocked(prisma.mediaAsset.create);
const findFirstMock = vi.mocked(prisma.mediaAsset.findFirst);
const deleteMock = vi.mocked(prisma.mediaAsset.delete);
const findManyMock = vi.mocked(prisma.mediaAsset.findMany);
const uploadMock = vi.mocked(uploadInboundMedia);
const removeMock = vi.mocked(removeMediaObjects);

beforeEach(() => vi.clearAllMocks());

describe("createMediaAsset", () => {
  it("sobe o binário e grava o metadado (image)", async () => {
    uploadMock.mockResolvedValue("acc_1/uuid.png");
    createMock.mockResolvedValue({
      id: "ma_1", label: "cardápio", mediaPath: "acc_1/uuid.png", mediaType: "image",
      mediaMime: "image/png", fileName: "cardapio.png", createdAt: new Date(),
    } as never);
    const dto = await createMediaAsset("acc_1", {
      label: "cardápio", buffer: Buffer.from("x"), mime: "image/png", fileName: "cardapio.png",
    });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock.mock.calls[0][1]).toMatchObject({ leadId: "acc_1", mime: "image/png", ext: "png" });
    expect(createMock.mock.calls[0][0].data).toMatchObject({ accountId: "acc_1", mediaType: "image", mediaPath: "acc_1/uuid.png" });
    expect(dto.mediaType).toBe("image");
  });

  it("PDF → mediaType document", async () => {
    uploadMock.mockResolvedValue("acc_1/uuid.pdf");
    createMock.mockResolvedValue({
      id: "ma_2", label: "tabela", mediaPath: "acc_1/uuid.pdf", mediaType: "document",
      mediaMime: "application/pdf", fileName: null, createdAt: new Date(),
    } as never);
    await createMediaAsset("acc_1", { label: "tabela", buffer: Buffer.from("x"), mime: "application/pdf" });
    expect(createMock.mock.calls[0][0].data.mediaType).toBe("document");
    expect(uploadMock.mock.calls[0][1].ext).toBe("pdf");
  });

  it("Storage não configurado (upload null) → lança e não grava", async () => {
    uploadMock.mockResolvedValue(null);
    await expect(
      createMediaAsset("acc_1", { label: "x", buffer: Buffer.from("x"), mime: "image/png" }),
    ).rejects.toThrow(/Storage/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rótulo vazio → lança antes de subir nada", async () => {
    await expect(
      createMediaAsset("acc_1", { label: "   ", buffer: Buffer.from("x"), mime: "image/png" }),
    ).rejects.toThrow(/rótulo/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("deleteMediaAsset", () => {
  it("apaga o binário e a linha, escopado por conta", async () => {
    findFirstMock.mockResolvedValue({ mediaPath: "acc_1/uuid.png" } as never);
    removeMock.mockResolvedValue(true);
    deleteMock.mockResolvedValue({} as never);
    await deleteMediaAsset("acc_1", "ma_1");
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "ma_1", accountId: "acc_1" }, select: { mediaPath: true } });
    expect(removeMock).toHaveBeenCalledWith(["acc_1/uuid.png"]);
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: "ma_1" } });
  });

  it("asset de outra conta / inexistente → lança", async () => {
    findFirstMock.mockResolvedValue(null);
    await expect(deleteMediaAsset("acc_1", "ma_x")).rejects.toThrow(/não encontrada/i);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("listMediaAssets", () => {
  it("mapeia para DTO", async () => {
    findManyMock.mockResolvedValue([
      { id: "ma_1", label: "cardápio", mediaPath: "p", mediaType: "image", mediaMime: "image/png", fileName: null, createdAt: new Date() },
    ] as never);
    const out = await listMediaAssets("acc_1");
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("cardápio");
    expect(findManyMock).toHaveBeenCalledWith({ where: { accountId: "acc_1" }, orderBy: { createdAt: "desc" } });
  });
});
