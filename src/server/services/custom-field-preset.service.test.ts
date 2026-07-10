import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { seedCustomFieldPreset } from "@/server/services/custom-field-preset.service";
import { listDefs } from "@/server/services/custom-field.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `cfp_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("seedCustomFieldPreset (escopo PRODUCT)", () => {
  it("cria defs de escopo PRODUCT a partir do preset do ramo", async () => {
    const a = await makeOwner();
    await seedCustomFieldPreset(a, "revenda-veiculos");
    const defs = await listDefs(a, "PRODUCT");
    expect(defs.some((d) => d.key === "marca")).toBe(true);
    expect(defs.some((d) => d.key === "combustivel")).toBe(true);
  });

  it("labels iguais em escopos diferentes coexistem (unique inclui scope)", async () => {
    const a = await makeOwner();
    // revenda-veiculos tem "KM"/"Cor" tanto em ORDER_ITEM quanto em PRODUCT.
    await seedCustomFieldPreset(a, "revenda-veiculos");
    const itemScope = await listDefs(a, "ORDER_ITEM");
    const productScope = await listDefs(a, "PRODUCT");
    expect(itemScope.some((d) => d.key === "km")).toBe(true);
    expect(productScope.some((d) => d.key === "km")).toBe(true);
  });

  it("é idempotente (2ª chamada não recria)", async () => {
    const a = await makeOwner();
    const first = await seedCustomFieldPreset(a, "revenda-veiculos");
    const second = await seedCustomFieldPreset(a, "revenda-veiculos");
    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
  });
});

describe("seedCustomFieldPreset (presets curados por ramo)", () => {
  it("semeia campo ORDER de serviço (salão → profissional)", async () => {
    const a = await makeOwner();
    await seedCustomFieldPreset(a, "salao-beleza");
    const defs = await listDefs(a, "ORDER");
    expect(defs.some((d) => d.key === "profissional")).toBe(true);
  });

  it("semeia campo DATE (fotografia → data do evento)", async () => {
    const a = await makeOwner();
    await seedCustomFieldPreset(a, "fotografia-filmagem");
    const defs = await listDefs(a, "ORDER");
    const data = defs.find((d) => d.key === "data_do_evento");
    expect(data?.type).toBe("DATE");
  });

  it("semeia campos por item (viagens → destino)", async () => {
    const a = await makeOwner();
    await seedCustomFieldPreset(a, "agencia-viagens");
    const defs = await listDefs(a, "ORDER_ITEM");
    expect(defs.some((d) => d.key === "destino")).toBe(true);
    expect(defs.some((d) => d.key === "n_de_pessoas")).toBe(true);
  });
});
