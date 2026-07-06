import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import {
  slugify,
  getBookingSettings,
  setBookingSettings,
  ensureSlug,
} from "./booking-settings.service";

async function makeOwner(name = "Dono") {
  const u = await prisma.user.create({
    data: {
      email: `bset_${Math.round(performance.now())}_${Math.random()}@t.test`,
      name,
      passwordHash: "x",
    },
  });
  return u.id;
}

describe("slugify (PURA)", () => {
  it("baixa caixa, tira acento, espaço/símbolo vira hífen, sem borda de hífen", () => {
    expect(slugify("Salão da Ana")).toBe("salao-da-ana");
    expect(slugify("  Café & Cia!  ")).toBe("cafe-cia");
    expect(slugify("Studio—Beleza  Pró")).toBe("studio-beleza-pro");
    expect(slugify("Ação")).toBe("acao");
  });

  it("string vazia ou só símbolos → ''", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});

describe("booking-settings.service", () => {
  it("getBookingSettings devolve os defaults do schema", async () => {
    const acc = await makeOwner();
    const s = await getBookingSettings(acc);
    expect(s).toEqual({
      publicSlug: null,
      bookingEnabled: false,
      bookingLeadMinutes: 120,
      bookingHorizonDays: 30,
      bookingSlotStep: 15,
    });
  });

  it("setBookingSettings aplica patch e respeita limites de zod", async () => {
    const acc = await makeOwner();
    const s = await setBookingSettings(acc, {
      bookingEnabled: true,
      bookingLeadMinutes: 60,
      bookingHorizonDays: 45,
      bookingSlotStep: 30,
    });
    expect(s.bookingEnabled).toBe(true);
    expect(s.bookingLeadMinutes).toBe(60);
    expect(s.bookingHorizonDays).toBe(45);
    expect(s.bookingSlotStep).toBe(30);

    // limites: horizonte 0/181 e passo 4/121 rejeitados
    await expect(setBookingSettings(acc, { bookingHorizonDays: 0 })).rejects.toThrow();
    await expect(setBookingSettings(acc, { bookingHorizonDays: 181 })).rejects.toThrow();
    await expect(setBookingSettings(acc, { bookingSlotStep: 4 })).rejects.toThrow();
    await expect(setBookingSettings(acc, { bookingSlotStep: 121 })).rejects.toThrow();
    await expect(setBookingSettings(acc, { bookingLeadMinutes: -1 })).rejects.toThrow();
  });

  // Token único por execução: o slug é @unique global e o DB de teste acumula entre
  // rodadas — bases fixas colidiriam e o sufixo de ensureSlug faria a asserção derivar.
  const token = () => `t${Math.round(performance.now())}${Math.floor(Math.random() * 1e6)}`;

  it("setBookingSettings normaliza o slug e barra duplicado", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const base = `Salão ${token()}!`;
    const expected = slugify(base);
    const sa = await setBookingSettings(a, { publicSlug: base });
    expect(sa.publicSlug).toBe(expected);

    // outra conta não pode pegar o mesmo slug
    await expect(setBookingSettings(b, { publicSlug: expected })).rejects.toThrow(
      /já está em uso/,
    );

    // slug que vira vazio após slugify → erro
    await expect(setBookingSettings(b, { publicSlug: "!!!" })).rejects.toThrow();

    // a própria conta pode re-setar o seu slug atual
    const again = await setBookingSettings(a, { publicSlug: expected });
    expect(again.publicSlug).toBe(expected);
  });

  it("ensureSlug gera do nome, é idempotente e resolve colisão com sufixo", async () => {
    const name = `Barbearia ${token()}`;
    const base = slugify(name);
    const a = await makeOwner(name);
    expect(await ensureSlug(a)).toBe(base);

    // idempotente: chamar de novo devolve o mesmo, não sobrescreve
    expect(await ensureSlug(a)).toBe(base);

    // colisão: outra conta com o mesmo nome ganha sufixo
    const b = await makeOwner(name);
    expect(await ensureSlug(b)).toBe(`${base}-2`);
  });

  it("ensureSlug prefere o appName do branding quando existe", async () => {
    const acc = await makeOwner(`Nome Fiscal ${token()}`);
    const appName = `Espaço ${token()}`;
    await prisma.accountBranding.create({ data: { accountId: acc, appName } });
    expect(await ensureSlug(acc)).toBe(slugify(appName));
  });
});
