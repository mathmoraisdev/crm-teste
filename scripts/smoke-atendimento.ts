/**
 * Smoke E2E do ATENDIMENTO multi-empresa — sem chip pareado, sem navegador.
 *
 * Exercita o pipeline REAL `handleInbound` (criação de contato no inbound +
 * roteamento pelos toggles da empresa) em modo `mock`: a resposta da IA é
 * GRAVADA como Message(OUTBOUND) em vez de sair num WhatsApp real.
 *
 * Uso:  npm run smoke:atendimento
 *
 * Pré: `npm run seed` ao menos uma vez (precisa de 1 User) e uma chave de IA
 * disponível (BYOK do usuário ou OPENAI_API_KEY da plataforma) para os cenários
 * que respondem/qualificam. NÃO mexe em dados fora das 3 empresas de smoke.
 */

// Força o modo mock ANTES de qualquer import que leia env (todos dinâmicos abaixo),
// para a resposta da IA ser só persistida — nunca enviada por um chip real.
process.env.WHATSAPP_MODE = "mock";

// Marca o arquivo como módulo (escopo próprio) — sem isto, `uid` colide com a
// declaração homônima de smoke-financeiro.ts no type-check do build.
export {};

const KB =
  "Vendemos guarda-chuvas e capas de chuva. Frete grátis acima de R$100. " +
  "Entregamos em todo o estado de SP em até 3 dias úteis. " +
  "Horário de atendimento: Seg–Sex 9h–18h.";

const PHONES = {
  puro: "+5511970000001",
  qualify: "+5511970000002",
  handoff: "+5511970000003",
  iso: "+5511988887777",
};

function uid(tag: string) {
  return `smoke-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function main() {
  const { prisma } = await import("@/server/db/client");
  const { handleInbound } = await import("@/server/services/conversation.service");
  const { env } = await import("@/lib/env");
  const { resolveProviderForUser } = await import("@/server/ai/resolve");

  console.log(`\n🌱 Smoke de atendimento — WHATSAPP_MODE=${env.WHATSAPP_MODE} (resposta da IA é só gravada)\n`);
  if (env.WHATSAPP_MODE !== "mock") {
    throw new Error("Esperava WHATSAPP_MODE=mock — o override no topo do script não foi aplicado.");
  }

  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error('Nenhum usuário encontrado. Rode "npm run seed" primeiro.');
  console.log(`👤 Usuário: ${user.email ?? user.id}`);

  // A IA é necessária p/ responder/qualificar (cenários 1, 2, 4). O cenário 3
  // (autoReply off) não chama IA. Avisa cedo se não houver chave.
  let aiOk = true;
  try {
    const p = await resolveProviderForUser(user.id);
    console.log(`🔑 IA: ${p.provider} (fonte: ${p.source})`);
  } catch (e) {
    aiOk = false;
    console.warn(`⚠️  IA indisponível: ${(e as Error).message}`);
    console.warn("   → cenários que respondem/qualificam vão falhar; só o cenário 3 (handoff) roda limpo.\n");
  }

  // ── Empresas de smoke (idempotentes por (userId, phone)) ──────────────────
  async function upsertEmpresa(opts: {
    phone: string;
    label: string;
    sessionDir: string;
    autoReplyEnabled: boolean;
    qualifyEnabled: boolean;
    displayName: string;
  }) {
    const data = {
      label: opts.label,
      displayName: opts.displayName,
      knowledgeBase: KB,
      businessHours: "Seg–Sex 9h–18h",
      autoReplyEnabled: opts.autoReplyEnabled,
      qualifyEnabled: opts.qualifyEnabled,
      scheduleEnabled: false,
    };
    return prisma.whatsAppNumber.upsert({
      where: { userId_phone: { userId: user!.id, phone: opts.phone } },
      update: data,
      create: { userId: user!.id, phone: opts.phone, sessionDir: opts.sessionDir, ...data },
    });
  }

  const empA = await upsertEmpresa({
    phone: "+5511900000001", label: "SMOKE Empresa A", sessionDir: "smoke-empA",
    displayName: "Guarda-Chuvas Acme", autoReplyEnabled: true, qualifyEnabled: false,
  });
  const empB = await upsertEmpresa({
    phone: "+5511900000002", label: "SMOKE Empresa B", sessionDir: "smoke-empB",
    displayName: "Acme Vendas", autoReplyEnabled: true, qualifyEnabled: true,
  });
  const empC = await upsertEmpresa({
    phone: "+5511900000003", label: "SMOKE Empresa C", sessionDir: "smoke-empC",
    displayName: "Acme Suporte", autoReplyEnabled: false, qualifyEnabled: false,
  });
  const numIds = [empA.id, empB.id, empC.id];

  // ── Limpeza ESCOPADA (só leads dessas 3 empresas — não toca o resto) ──────
  const old = await prisma.lead.findMany({ where: { whatsAppNumberId: { in: numIds } }, select: { id: true } });
  const oldIds = old.map((l) => l.id);
  if (oldIds.length) {
    await prisma.message.deleteMany({ where: { leadId: { in: oldIds } } });
    await prisma.qualification.deleteMany({ where: { leadId: { in: oldIds } } });
    await prisma.meeting.deleteMany({ where: { leadId: { in: oldIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: oldIds } } });
  }
  console.log(`🧹 Limpou ${oldIds.length} lead(s) de smoke anteriores.\n`);

  async function inbound(numId: string, phone: string, text: string, tag: string) {
    try {
      return await handleInbound({ whatsAppNumberId: numId, phone, userId: user!.id, text, providerMessageId: uid(tag) });
    } catch (e) {
      console.error(`   ❌ handleInbound falhou: ${(e as Error).message}`);
      return null;
    }
  }

  async function report(numId: string, phone: string) {
    const lead = await prisma.lead.findFirst({
      where: { whatsAppNumberId: numId, phone },
      include: { messages: { orderBy: { createdAt: "asc" } }, qualification: true },
    });
    if (!lead) {
      console.log("   (nenhum lead — não criado)");
      return null;
    }
    const ins = lead.messages.filter((m) => m.direction === "INBOUND").length;
    const outs = lead.messages.filter((m) => m.direction === "OUTBOUND");
    console.log(`   lead=${lead.id} status=${lead.status} consent=${lead.consentSource ?? "—"}`);
    console.log(`   mensagens: ${ins} INBOUND, ${outs.length} OUTBOUND`);
    if (outs.length) console.log(`   💬 resposta: "${outs[outs.length - 1].content.slice(0, 160)}"`);
    if (lead.qualification) console.log(`   📊 qualification: score=${lead.qualification.score} nextAction=${lead.qualification.nextAction ?? "—"}`);
    return lead;
  }

  // ── Cenário 1: atendimento puro + base de conhecimento ────────────────────
  console.log("①  Atendimento puro (autoReply on, qualify off) — Empresa A");
  await inbound(empA.id, PHONES.puro, "vocês entregam em SP?", "puro");
  const l1 = await report(empA.id, PHONES.puro);
  console.log(
    `   ${l1 && l1.status === "EM_CONVERSA" && l1.consentSource === "inbound" && l1.messages.some((m) => m.direction === "OUTBOUND") && !l1.qualification
      ? "✅ contato criado + respondeu pela base, sem qualificação"
      : "⚠️  divergente — confira acima"}\n`,
  );

  // ── Cenário 2: atendimento + qualificação ─────────────────────────────────
  console.log("②  Atendimento + qualificação (qualify on) — Empresa B");
  await inbound(empB.id, PHONES.qualify, "tenho muito interesse, quero comprar 200 unidades pra minha loja, é urgente", "qualify");
  const l2 = await report(empB.id, PHONES.qualify);
  console.log(
    `   ${l2 && l2.qualification ? "✅ respondeu E criou Qualification com score" : "⚠️  sem Qualification — confira acima"}\n`,
  );

  // ── Cenário 3: autoReply off → handoff (sem resposta) ─────────────────────
  console.log("③  Handoff (autoReply off) — Empresa C");
  await inbound(empC.id, PHONES.handoff, "oi, tem alguém aí?", "handoff");
  const l3 = await report(empC.id, PHONES.handoff);
  console.log(
    `   ${l3 && !l3.messages.some((m) => m.direction === "OUTBOUND") ? "✅ só persistiu INBOUND, nenhuma resposta (handoff)" : "⚠️  respondeu mesmo com autoReply off — confira"}\n`,
  );

  // ── Cenário 4: isolamento entre empresas (mesmo telefone, 2 empresas) ──────
  console.log("④  Isolamento — mesmo telefone falando com Empresa A e Empresa B");
  await inbound(empA.id, PHONES.iso, "oi A", "iso-a");
  await inbound(empB.id, PHONES.iso, "oi B", "iso-b");
  const leadsIso = await prisma.lead.findMany({
    where: { phone: PHONES.iso, whatsAppNumberId: { in: [empA.id, empB.id] } },
    select: { id: true, whatsAppNumberId: true },
  });
  const distinct = new Set(leadsIso.map((l) => l.whatsAppNumberId));
  console.log(`   leads p/ ${PHONES.iso}: ${leadsIso.length} (empresas distintas: ${distinct.size})`);
  console.log(
    `   ${leadsIso.length === 2 && distinct.size === 2 ? "✅ dois contatos distintos, um por empresa (identidade por whatsAppNumberId)" : "⚠️  esperava 2 leads em 2 empresas — confira"}\n`,
  );

  console.log("🏁 Smoke concluído. Os dados ficam nas empresas SMOKE A/B/C (veja no Prisma Studio).");
  if (!aiOk) console.log("   (cenários 1/2/4 dependem de IA — configure a chave e rode de novo p/ validar a resposta.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("@/server/db/client");
    await prisma.$disconnect();
  });
