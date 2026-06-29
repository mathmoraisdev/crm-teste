// Backfill BEST-EFFORT do campo Message.source para linhas OUTBOUND anteriores
// à migração 20260629010000_message_source (onde source ficou NULL).
//
// Necessário porque a métrica "Resposta da IA" do painel só conta mensagens com
// source=AI; sem backfill, o histórico não aparece. A classificação é APROXIMADA
// (ver regras abaixo) — daí o dry-run por padrão.
//
// Regras de classificação (em ordem; a 1ª que casar vence):
//   1) Conteúdo == mensagem fixa de cota estourada  -> SYSTEM
//   2) Casa com um OutboundJob enviado (mesmo lead, ~120s de sentAt):
//        kind="manual_reply"            -> OPERATOR
//        kind in (template|freeform)    -> CAMPAIGN
//   3) Casa com um lembrete de reunião (Meeting.remindedDayBeforeAt/HourBeforeAt
//      do mesmo lead, ~120s)            -> SYSTEM
//   4) Resto (caminho sendWhatsAppMessage: resposta conversacional + propostas/
//      confirmações de agendamento)     -> AI
//
// LIMITAÇÃO conhecida: a resposta manual digitada pelo operador no PRÓPRIO
// WhatsApp (sem OutboundJob) é indistinguível da IA por dados e cai em AI.
// Em contas que usam o inbox do CRM isso é raro.
//
// Aponta pro banco da env DATABASE_URL. Dry-run (não escreve):
//   bash:        DATABASE_URL="postgresql://...." node scripts/backfill-message-source.mjs
//   PowerShell:  $env:DATABASE_URL="postgresql://...."; node scripts/backfill-message-source.mjs
// Aplicar de fato: acrescente --apply
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WINDOW_MS = 120_000; // tolerância de tempo p/ casar Message x Job/lembrete
const QUOTA_MSG =
  "Recebi sua mensagem! 🙌 Em instantes um de nossos atendentes vai continuar por aqui.";

// Acha o item de `events` (ordenado por ts) mais próximo de `ts` dentro da janela
// e ainda não reivindicado. Retorna o índice ou -1.
function claimNearest(events, ts, claimed) {
  let best = -1;
  let bestDelta = WINDOW_MS + 1;
  for (let i = 0; i < events.length; i++) {
    if (claimed.has(i)) continue;
    const delta = Math.abs(events[i].ts - ts);
    if (delta <= WINDOW_MS && delta < bestDelta) {
      best = i;
      bestDelta = delta;
    }
  }
  return best;
}

const messages = await prisma.message.findMany({
  where: { direction: "OUTBOUND", source: null },
  select: { id: true, leadId: true, content: true, createdAt: true },
  orderBy: { createdAt: "asc" },
});

if (messages.length === 0) {
  console.log("Nada a fazer: nenhum OUTBOUND com source NULL.");
  await prisma.$disconnect();
  process.exit(0);
}

// Eventos de referência por lead (jobs enviados + lembretes), p/ casar por tempo.
const jobs = await prisma.outboundJob.findMany({
  where: { sentAt: { not: null } },
  select: { leadId: true, kind: true, sentAt: true },
});
const meetings = await prisma.meeting.findMany({
  where: { OR: [{ remindedDayBeforeAt: { not: null } }, { remindedHourBeforeAt: { not: null } }] },
  select: { leadId: true, remindedDayBeforeAt: true, remindedHourBeforeAt: true },
});

// Index por lead.
const jobsByLead = new Map();
for (const j of jobs) {
  const arr = jobsByLead.get(j.leadId) ?? [];
  arr.push({ ts: j.sentAt.getTime(), kind: j.kind });
  jobsByLead.set(j.leadId, arr);
}
const remindersByLead = new Map();
for (const m of meetings) {
  const arr = remindersByLead.get(m.leadId) ?? [];
  if (m.remindedDayBeforeAt) arr.push({ ts: m.remindedDayBeforeAt.getTime() });
  if (m.remindedHourBeforeAt) arr.push({ ts: m.remindedHourBeforeAt.getTime() });
  remindersByLead.set(m.leadId, arr);
}
for (const arr of jobsByLead.values()) arr.sort((a, b) => a.ts - b.ts);
for (const arr of remindersByLead.values()) arr.sort((a, b) => a.ts - b.ts);

// `claimed` por lead evita que dois Messages casem com o mesmo job/lembrete.
const claimedJobs = new Map();
const claimedReminders = new Map();
const buckets = { AI: [], OPERATOR: [], CAMPAIGN: [], SYSTEM: [] };

for (const msg of messages) {
  const ts = msg.createdAt.getTime();

  // 1) cota estourada (mensagem fixa)
  if (msg.content === QUOTA_MSG) {
    buckets.SYSTEM.push(msg.id);
    continue;
  }

  // 2) OutboundJob (operador via inbox / campanha)
  const leadJobs = jobsByLead.get(msg.leadId);
  if (leadJobs) {
    const claimed = claimedJobs.get(msg.leadId) ?? new Set();
    const idx = claimNearest(leadJobs, ts, claimed);
    if (idx >= 0) {
      claimed.add(idx);
      claimedJobs.set(msg.leadId, claimed);
      buckets[leadJobs[idx].kind === "manual_reply" ? "OPERATOR" : "CAMPAIGN"].push(msg.id);
      continue;
    }
  }

  // 3) lembrete de reunião
  const leadReminders = remindersByLead.get(msg.leadId);
  if (leadReminders) {
    const claimed = claimedReminders.get(msg.leadId) ?? new Set();
    const idx = claimNearest(leadReminders, ts, claimed);
    if (idx >= 0) {
      claimed.add(idx);
      claimedReminders.set(msg.leadId, claimed);
      buckets.SYSTEM.push(msg.id);
      continue;
    }
  }

  // 4) resto = resposta da IA (conversa + agendamento)
  buckets.AI.push(msg.id);
}

console.log(`OUTBOUND com source NULL: ${messages.length}`);
console.log("Distribuição proposta:");
for (const [src, ids] of Object.entries(buckets)) {
  console.log(`  ${src.padEnd(9)} ${ids.length}`);
}

if (!APPLY) {
  console.log("\nDRY-RUN (nada escrito). Reexecute com --apply para gravar.");
  await prisma.$disconnect();
  process.exit(0);
}

// Aplica em lotes (updateMany por id).
const CHUNK = 500;
for (const [src, ids] of Object.entries(buckets)) {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    await prisma.message.updateMany({ where: { id: { in: slice } }, data: { source: src } });
  }
}
console.log("\n✓ Aplicado.");
await prisma.$disconnect();
