import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { listNotes, addNote } from "./internal-note.service";

async function makeOwner() {
  const u = await prisma.user.create({
    data: { email: `note_${Math.round(performance.now())}_${Math.random()}@t.test`, name: "Op", passwordHash: "x" },
  });
  return u.id;
}

async function makeLead(accountId: string) {
  const lead = await prisma.lead.create({
    data: { userId: accountId, name: "Cliente", phone: `+55${Math.round(performance.now())}${Math.floor(Math.random() * 1000)}` },
  });
  return lead.id;
}

describe("internal-note.service", () => {
  it("adiciona e lista notas de uma conversa da conta", async () => {
    const a = await makeOwner();
    const lead = await makeLead(a);
    await addNote(a, lead, a, "Cliente pediu desconto");
    await addNote(a, lead, a, "Vai pensar até amanhã");
    const notes = await listNotes(a, lead);
    expect(notes).toHaveLength(2);
    expect(notes[0].body).toBe("Cliente pediu desconto"); // ordem cronológica
    expect(notes[0].author.id).toBe(a);
  });

  it("rejeita nota vazia", async () => {
    const a = await makeOwner();
    const lead = await makeLead(a);
    await expect(addNote(a, lead, a, "   ")).rejects.toThrow();
  });

  it("escopo por conta: não vê nem escreve nota de lead de outra conta", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const leadA = await makeLead(a);
    await addNote(a, leadA, a, "secreta");
    // b tenta ler/escrever no lead de a
    await expect(listNotes(b, leadA)).rejects.toThrow(/não encontrada/i);
    await expect(addNote(b, leadA, b, "invasão")).rejects.toThrow(/não encontrada/i);
  });
});
