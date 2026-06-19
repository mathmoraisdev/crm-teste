// Inspeciona (SÓ LEITURA) o estado real dos leads recentes: status, meeting,
// contagem de INBOUND/OUTBOUND e formato do telefone. Serve pra confirmar por
// que a IA ficou muda após o disparo (ex.: 9º dígito divergente no inbound).
//
// Aponta pro banco que estiver na env DATABASE_URL. Para checar PRODUÇÃO:
//   bash:        DATABASE_URL="postgresql://...prod..." node scripts/inspect-leads.mjs
//   PowerShell:  $env:DATABASE_URL="postgresql://...prod..."; node scripts/inspect-leads.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const totalIn = await prisma.message.count({ where: { direction: "INBOUND" } });
const totalOut = await prisma.message.count({ where: { direction: "OUTBOUND" } });
console.log(`Banco: INBOUND=${totalIn}  OUTBOUND=${totalOut}\n`);

// Números + persistência do auth state (Baileys). Se um número CONNECTED tem
// poucas/nenhuma linha de session-*, a descriptografia falha (msg perdida).
const numbers = await prisma.whatsAppNumber.findMany({
  select: { id: true, label: true, status: true },
});
for (const n of numbers) {
  const rows = await prisma.whatsAppAuthState.findMany({
    where: { numberId: n.id },
    select: { key: true },
  });
  const creds = rows.some((r) => r.key === "creds");
  const sessions = rows.filter((r) => r.key.startsWith("session-")).length;
  const preKeys = rows.filter((r) => r.key.startsWith("pre-key-")).length;
  console.log(
    `Número "${n.label}" [${n.status}]  authState: creds=${creds ? "sim" : "NÃO"} sessions=${sessions} preKeys=${preKeys} (total=${rows.length})`,
  );
}
console.log("");

const leads = await prisma.lead.findMany({
  orderBy: { updatedAt: "desc" },
  take: 20,
  include: {
    meeting: { select: { status: true } },
    _count: { select: { messages: true } },
    messages: { orderBy: { createdAt: "desc" }, take: 5, select: { direction: true, content: true, createdAt: true } },
  },
});

for (const l of leads) {
  const ins = l.messages.filter((m) => m.direction === "INBOUND").length;
  const digits = l.phone.replace(/\D/g, "");
  console.log("─".repeat(72));
  console.log(`${l.name}  [${l.status}]  phone=${l.phone} (${digits.length} díg)  aiPaused=${l.aiPaused}  optOut=${l.optOut}`);
  console.log(`  chip=${l.whatsAppNumberId ?? "—"}  meeting=${l.meeting?.status ?? "nenhuma"}  msgs=${l._count.messages} (INBOUND nas últimas 5=${ins})`);
  for (const m of [...l.messages].reverse()) {
    const arrow = m.direction === "INBOUND" ? "←IN " : "→OUT";
    console.log(`  ${arrow} ${m.createdAt.toISOString().slice(5, 16)}  ${m.content.replace(/\n/g, " ⏎ ").slice(0, 80)}`);
  }
}

await prisma.$disconnect();
