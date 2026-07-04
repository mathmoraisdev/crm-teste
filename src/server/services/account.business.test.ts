import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { getBusinessTemplateId, setBusinessTemplateId } from "./account.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `biz_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "T", passwordHash: "x" },
  });
  return u.id;
}

describe("account business template", () => {
  it("começa null e persiste um id válido", async () => {
    const a = await makeOwner();
    expect(await getBusinessTemplateId(a)).toBeNull();
    await setBusinessTemplateId(a, "barbearia");
    expect(await getBusinessTemplateId(a)).toBe("barbearia");
  });

  it("aceita null (limpar) e rejeita id inexistente", async () => {
    const a = await makeOwner();
    await setBusinessTemplateId(a, "barbearia");
    await setBusinessTemplateId(a, null);
    expect(await getBusinessTemplateId(a)).toBeNull();
    await expect(setBusinessTemplateId(a, "nao-existe")).rejects.toThrow();
  });
});
