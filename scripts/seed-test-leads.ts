import { prisma } from "@/server/db/client";
import { normalizePhone } from "@/lib/phone";

/**
 * Popula uma campanha de teste p/ exercitar o fluxo Baileys.
 *
 * Uso: npm run seed:test -- "Maria:+5511999998888" "João:+5511988887777"
 *   - cada arg é "Nome:+E164" (o número é normalizado).
 *   - SEMPRE adiciona 1 lead "sem WhatsApp" (número improvável de existir) p/
 *     você ver o job virar CANCELLED ("número não está no WhatsApp").
 *
 * Idempotente: limpa leads/campanhas/mensagens antes (NÃO mexe nos chips
 * pareados em WhatsAppNumber).
 */
async function main() {
  const reais = process.argv
    .slice(2)
    .map((a) => {
      const idx = a.lastIndexOf(":");
      const name = (idx >= 0 ? a.slice(0, idx) : "Lead Teste").trim();
      const phone = normalizePhone((idx >= 0 ? a.slice(idx + 1) : a).trim());
      return { name: name || "Lead Teste", phone };
    })
    .filter((x): x is { name: string; phone: string } => !!x.phone);

  // Multi-conta: vincula tudo à primeira conta (rode `npm run seed` antes).
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) {
    throw new Error('Nenhum usuário encontrado. Rode "npm run seed" primeiro.');
  }

  console.log("🧹 limpando dados de teste anteriores (chips preservados)…");
  await prisma.message.deleteMany();
  await prisma.qualification.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.outboundJob.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.campaign.deleteMany();

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      name: "Teste Baileys",
      // spintax {a|b} (varia por lead) + {{nome}} (renderTemplate)
      messageTemplate:
        "{Oi|Olá|E aí} {{nome}}! {Tudo bem|Como vai}? Aqui é da Disparador.AI — posso te mostrar em 5 min como automatizar o atendimento no WhatsApp?",
      status: "DRAFT",
    },
  });

  // número improvável de estar no WhatsApp → testa o caminho CANCELLED
  const leads = [
    { name: "Fantasma (sem WhatsApp)", phone: "+5511900000000" },
    ...reais,
  ];

  for (const l of leads) {
    // Sem composite userId_phone (identidade agora é por whatsAppNumberId+phone):
    // idempotência manual por (userId, phone).
    const existing = await prisma.lead.findFirst({
      where: { userId: user.id, phone: l.phone },
      select: { id: true },
    });
    if (existing) {
      await prisma.lead.update({
        where: { id: existing.id },
        data: { name: l.name, status: "NOVO", optOut: false, campaignId: campaign.id },
      });
    } else {
      await prisma.lead.create({
        data: { userId: user.id, name: l.name, phone: l.phone, status: "NOVO", campaignId: campaign.id },
      });
    }
    console.log(`  + ${l.name} — ${l.phone}`);
  }

  console.log(
    `\n✅ Campanha "Teste Baileys" criada com ${leads.length} lead(s).` +
      `\n   Abra /campaigns e clique "Iniciar" (ou aguarde, se já iniciada).`,
  );
  if (reais.length === 0) {
    console.log(
      "\n⚠️  Nenhum número real informado — só o lead sem WhatsApp foi criado." +
        '\n   Rode: npm run seed:test -- "SeuNome:+55SEUNUMERO"',
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
