import { describe, it, expect } from "vitest";

/**
 * Regressão do incidente de PRODUÇÃO: `confirmBooking` (link público /agendar)
 * dava "Timed out fetching a new connection from the connection pool (connection
 * limit: 1)" em toda confirmação.
 *
 * Causa: a confirmação corre numa transação interativa (`prisma.$transaction`)
 * que SEGURA a única conexão do pool. Se qualquer query dentro dela usar o client
 * GLOBAL (`prisma`) em vez do `tx`, pede uma 2ª conexão — que nunca vem, pois a
 * transação segura a única (`connection_limit=1`, como o pooler do Supabase). O
 * fix passou o `tx` por toda a cadeia de leitura/validação.
 *
 * Este teste reproduz o cenário: força o singleton do Prisma a subir com
 * `connection_limit=1` (append na DATABASE_URL ANTES do import dinâmico do client)
 * e confirma que a marcação completa em vez de estourar o pool. Sem o fix, a
 * primeira leitura na transação trava e o teste falha após `pool_timeout`.
 */

// Sobe o pool com 1 conexão só, como em produção. Mutado ANTES do import dinâmico
// do client (imports estáticos são hoisted; `await import` roda depois disto).
const base =
  process.env.DATABASE_URL || "postgresql://crm:crm@localhost:5432/crm?schema=public";
process.env.DATABASE_URL = base.includes("connection_limit")
  ? base
  : `${base}${base.includes("?") ? "&" : "?"}connection_limit=1&pool_timeout=3`;

const { prisma } = await import("@/server/db/client");
const { createCatalogItem } = await import("./catalog.service");
const { confirmBooking } = await import("./booking-availability.service");

describe("confirmBooking sob connection_limit=1 (pool de produção)", () => {
  it(
    "confirma a marcação sem estourar o pool de conexões",
    async () => {
      const owner = await prisma.user.create({
        data: {
          email: `pool_${Math.round(performance.now())}_${Math.random()}@t.test`,
          name: "Salão",
          passwordHash: "x",
          bookingEnabled: true,
        },
      });
      const item = await createCatalogItem(owner.id, { name: "Corte", priceCents: 5000 });
      await prisma.catalogItem.update({
        where: { id: item.id },
        data: { durationMinutes: 30 },
      });
      const pro = await prisma.professional.create({
        data: { accountId: owner.id, name: "Ana" },
      });

      // 3h à frente: > bookingLeadMinutes (120) e < horizonte (30 dias).
      const startISO = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

      const result = await confirmBooking(owner.id, {
        catalogItemId: item.id,
        professionalId: pro.id,
        startISO,
        customerName: "Cliente Teste",
        customerPhone: "+5511988887777",
      });

      expect(result.appointmentId).toBeTruthy();
      // Conta sem chip conectado → cai para walk-in (sem lead/lembrete).
      expect(result.isWalkIn).toBe(true);

      const appt = await prisma.appointment.findUniqueOrThrow({
        where: { id: result.appointmentId },
      });
      expect(appt.professionalId).toBe(pro.id);
      expect(appt.source).toBe("ONLINE");
    },
    25_000,
  );
});
