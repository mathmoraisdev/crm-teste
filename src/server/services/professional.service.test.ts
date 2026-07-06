import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import {
  listProfessionals,
  createProfessional,
  updateProfessional,
  deactivateProfessional,
  listWorkingHours,
  setWorkingHours,
  resolveWorkingWindows,
} from "./professional.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `prof_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "Dono", passwordHash: "x" },
  });
  return u.id;
}
async function makeMember(ownerId: string, name = "Membro") {
  const u = await prisma.user.create({
    data: { email: `mem_${Math.round(performance.now())}_${Math.random()}@t.test`, name, passwordHash: "x", ownerId },
  });
  return u.id;
}

describe("professional.service", () => {
  it("cria, lista (ativo desc, nome asc) e não vaza entre contas", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();

    const zara = await createProfessional(acc, { name: "Zara" });
    const ana = await createProfessional(acc, { name: "Ana" });
    await createProfessional(other, { name: "Estranho" });

    // desativa Zara → ordem: ativos primeiro (Ana), depois inativos (Zara)
    await deactivateProfessional(acc, zara.id);
    const list = await listProfessionals(acc);
    expect(list.map((p) => p.name)).toEqual(["Ana", "Zara"]);
    expect(list.find((p) => p.id === ana.id)?.active).toBe(true);
    expect(list.find((p) => p.id === zara.id)?.active).toBe(false);

    // outra conta só enxerga o seu
    expect((await listProfessionals(other)).map((p) => p.name)).toEqual(["Estranho"]);

    // activeOnly esconde o desativado
    expect((await listProfessionals(acc, { activeOnly: true })).map((p) => p.name)).toEqual(["Ana"]);
  });

  it("vincula um membro da conta e expõe memberName", async () => {
    const acc = await makeOwner();
    const memberId = await makeMember(acc, "João");
    const p = await createProfessional(acc, { name: "João Prof", userId: memberId });
    expect(p.userId).toBe(memberId);
    expect(p.memberName).toBe("João");

    // o próprio dono também é membro válido
    const p2 = await createProfessional(acc, { name: "Dono Prof", userId: acc });
    expect(p2.userId).toBe(acc);
  });

  it("rejeita vincular um usuário de outra conta", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const foreignMember = await makeMember(other);
    await expect(
      createProfessional(acc, { name: "X", userId: foreignMember }),
    ).rejects.toThrow();

    const p = await createProfessional(acc, { name: "Y" });
    await expect(
      updateProfessional(acc, p.id, { userId: foreignMember }),
    ).rejects.toThrow();
  });

  it("update respeita a posse (conta errada não altera)", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const p = await createProfessional(acc, { name: "Ana", color: "brand" });
    await expect(updateProfessional(other, p.id, { name: "Hackeada" })).rejects.toThrow();

    const upd = await updateProfessional(acc, p.id, { name: "Ana Maria", color: "forest" });
    expect(upd.name).toBe("Ana Maria");
    expect(upd.color).toBe("forest");
  });

  it("deactivate é SOFT: mantém a linha com active=false", async () => {
    const acc = await makeOwner();
    const p = await createProfessional(acc, { name: "Bea" });
    const off = await deactivateProfessional(acc, p.id);
    expect(off.active).toBe(false);
    // a linha continua existindo (histórico preservado)
    const still = await prisma.professional.findUnique({ where: { id: p.id } });
    expect(still).not.toBeNull();

    // deactivate de outra conta não mexe
    const other = await makeOwner();
    await expect(deactivateProfessional(other, p.id)).rejects.toThrow();
  });

  it("desvincula o membro com userId null", async () => {
    const acc = await makeOwner();
    const memberId = await makeMember(acc);
    const p = await createProfessional(acc, { name: "P", userId: memberId });
    const upd = await updateProfessional(acc, p.id, { userId: null });
    expect(upd.userId).toBeNull();
    expect(upd.memberName).toBeNull();
  });
});

describe("professional.service — working hours", () => {
  it("setWorkingHours faz REPLACE-ALL do escpo e lista por weekday asc", async () => {
    const acc = await makeOwner();
    // grade padrão da conta (professionalId null)
    await setWorkingHours(acc, null, [
      { weekday: 3, startMinute: 540, endMinute: 1080 },
      { weekday: 1, startMinute: 540, endMinute: 1080, breakStart: 720, breakEnd: 780 },
    ]);
    const first = await listWorkingHours(acc, null);
    expect(first.map((r) => r.weekday)).toEqual([1, 3]); // ordenado
    expect(first[0].breakStart).toBe(720);

    // replace-all: nova grade substitui a anterior
    await setWorkingHours(acc, null, [{ weekday: 5, startMinute: 600, endMinute: 900 }]);
    const second = await listWorkingHours(acc, null);
    expect(second.map((r) => r.weekday)).toEqual([5]);
  });

  it("grade por profissional é isolada do padrão da conta e valida posse", async () => {
    const acc = await makeOwner();
    const other = await makeOwner();
    const p = await createProfessional(acc, { name: "Ana" });

    await setWorkingHours(acc, null, [{ weekday: 1, startMinute: 540, endMinute: 1080 }]);
    await setWorkingHours(acc, p.id, [{ weekday: 2, startMinute: 600, endMinute: 720 }]);

    // escopos independentes
    expect((await listWorkingHours(acc, null)).map((r) => r.weekday)).toEqual([1]);
    expect((await listWorkingHours(acc, p.id)).map((r) => r.weekday)).toEqual([2]);

    // profissional de outra conta → rejeita
    await expect(
      setWorkingHours(other, p.id, [{ weekday: 1, startMinute: 540, endMinute: 1080 }]),
    ).rejects.toThrow();
  });

  it("rejeita startMinute >= endMinute e fora de 0..1440", async () => {
    const acc = await makeOwner();
    await expect(setWorkingHours(acc, null, [{ weekday: 1, startMinute: 800, endMinute: 800 }])).rejects.toThrow();
    await expect(setWorkingHours(acc, null, [{ weekday: 1, startMinute: 540, endMinute: 2000 }])).rejects.toThrow();
  });
});

describe("resolveWorkingWindows", () => {
  it("usa a grade própria do profissional quando existe", async () => {
    const acc = await makeOwner();
    const p = await createProfessional(acc, { name: "Ana" });
    await setWorkingHours(acc, null, [{ weekday: 1, startMinute: 540, endMinute: 1080 }]); // padrão 09–18
    await setWorkingHours(acc, p.id, [
      { weekday: 1, startMinute: 600, endMinute: 720, breakStart: 630, breakEnd: 645 }, // própria 10–12
    ]);
    const win = await resolveWorkingWindows(acc, p.id, 1);
    expect(win).toEqual([{ startMinute: 600, endMinute: 720, breakStart: 630, breakEnd: 645 }]);
  });

  it("cai no expediente padrão da conta quando o profissional não tem grade no dia", async () => {
    const acc = await makeOwner();
    const p = await createProfessional(acc, { name: "Ana" });
    await setWorkingHours(acc, null, [{ weekday: 2, startMinute: 540, endMinute: 1080 }]); // padrão terça
    await setWorkingHours(acc, p.id, [{ weekday: 1, startMinute: 600, endMinute: 720 }]); // própria só segunda
    // terça (weekday 2): profissional não tem → usa o padrão
    const win = await resolveWorkingWindows(acc, p.id, 2);
    expect(win).toEqual([{ startMinute: 540, endMinute: 1080, breakStart: null, breakEnd: null }]);
  });

  it("dia sem expediente (nem próprio nem padrão) → []", async () => {
    const acc = await makeOwner();
    const p = await createProfessional(acc, { name: "Ana" });
    await setWorkingHours(acc, null, [{ weekday: 1, startMinute: 540, endMinute: 1080 }]);
    // domingo (weekday 0): ninguém tem grade
    expect(await resolveWorkingWindows(acc, p.id, 0)).toEqual([]);
  });
});
