import { prisma } from "@/server/db/client";
import { connectNumber } from "@/server/whatsapp/baileys/pool";

/** Uso: npm run wa:link -- "chip-01" "+5511999999999" */
async function main() {
  const [label, phone] = process.argv.slice(2);
  if (!label || !phone) {
    console.error('Uso: npm run wa:link -- "<label>" "<+E164>"');
    process.exit(1);
  }
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) {
    console.error('Nenhum usuário encontrado. Rode "npm run seed" primeiro.');
    process.exit(1);
  }
  const slug = label.replace(/[^a-z0-9-]/gi, "_").toLowerCase();
  const sessionDir = `${user.id}__${slug}`;
  const rec = await prisma.whatsAppNumber.upsert({
    where: { userId_phone: { userId: user.id, phone } },
    update: { label, sessionDir, status: "CONNECTING" },
    create: { userId: user.id, label, phone, sessionDir, status: "CONNECTING", dailyCap: 30 },
  });
  console.log(`[wa:link] subindo socket de "${label}" — escaneie o QR abaixo.`);
  await connectNumber(rec.id);
  // mantém o processo vivo até conectar/escanear
  await new Promise(() => {});
}
main();
