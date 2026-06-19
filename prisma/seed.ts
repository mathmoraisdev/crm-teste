import { PrismaClient } from "@prisma/client";
import { normalizePhone } from "../src/lib/phone";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@disparador.ai";
const DEMO_PASSWORD = "disparador123";

/**
 * Seed: cria um usuário demo + uma campanha de exemplo + alguns leads NOVO,
 * todos vinculados a essa conta (multi-tenant). Idempotente.
 */
async function main() {
  console.log("🌱 Limpando dados anteriores…");
  await prisma.message.deleteMany();
  await prisma.qualification.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.outboundJob.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.whatsAppNumber.deleteMany();
  await prisma.user.deleteMany();

  console.log("🌱 Criando usuário demo…");
  const user = await prisma.user.create({
    data: {
      name: "Conta Demo",
      email: DEMO_EMAIL,
      passwordHash: hashPassword(DEMO_PASSWORD),
    },
  });

  console.log("🌱 Criando campanha de exemplo…");
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      name: "Prospecção — Software de Gestão",
      messageTemplate:
        "Olá {{nome}}! Aqui é da Acme. Vi que sua empresa pode se beneficiar da nossa solução de gestão. Faz sentido a gente conversar 5 minutinhos sobre seus desafios atuais?",
      status: "DRAFT",
    },
  });

  const sample: { name: string; phone: string }[] = [
    { name: "Ana Souza", phone: "+55 11 98888-1111" },
    { name: "Bruno Carvalho", phone: "(21) 97777-2222" },
    { name: "Carla Mendes", phone: "11 96666-3333" },
    { name: "Diego Ramos", phone: "+55 (31) 95555-4444" },
    { name: "Eduarda Lima", phone: "4194444-5555" },
    { name: "Felipe Nogueira", phone: "+55 51 93333-6666" },
  ];

  console.log(`🌱 Criando ${sample.length} leads…`);
  for (const s of sample) {
    const phone = normalizePhone(s.phone);
    if (!phone) {
      console.warn(`  ⚠️  telefone inválido ignorado: ${s.phone}`);
      continue;
    }
    await prisma.lead.create({
      data: {
        userId: user.id,
        name: s.name,
        phone,
        status: "NOVO",
        campaignId: campaign.id,
      },
    });
  }

  console.log("✅ Seed concluído.");
  console.log(`   Login demo → ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
