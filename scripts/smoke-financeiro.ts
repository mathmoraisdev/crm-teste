/**
 * Smoke do CONTROLE FINANCEIRO / suspensão de contas — sem chip, sem navegador.
 *
 * Exercita as funções REAIS contra o banco local (db push já aplicado):
 *  - cadastro novo nasce suspenso (billingActive=false)
 *  - trava: nunca suspende conta admin
 *  - toggle ativar/suspender
 *  - gate inbound: conta suspensa → ingestInbound respond=false (mas persiste)
 *  - reativar → inbound novo volta a responder
 *  - gate outbound: claimNextJobForAccount ignora job de conta suspensa (PENDING)
 *  - listAccountsForAdmin marca isAdmin corretamente
 *
 * Cria dados de teste isolados (e-mails smoke-fin-*) e LIMPA tudo no fim.
 * Uso: npx tsx --env-file-if-exists=.env scripts/smoke-financeiro.ts
 */

// Overrides ANTES de qualquer import que leia env.
process.env.WHATSAPP_MODE = "mock";
const ADMIN_EMAIL = "smoke-fin-admin@example.com";
process.env.ADMIN_EMAILS = ADMIN_EMAIL;

function uid(tag: string) {
  return `smoke-fin-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const results: { ok: boolean; name: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ ok, name });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const { prisma } = await import("@/server/db/client");
  const { registerUser } = await import("@/server/services/user.service");
  const { setAccountBilling, listAccountsForAdmin, isAccountActiveByLead } = await import(
    "@/server/services/account.service"
  );
  const { isAdminEmail } = await import("@/lib/admin");
  const { ingestInbound } = await import("@/server/services/conversation.service");
  const { claimNextJobForAccount } = await import("@/server/worker/dispatcher");

  console.log(`\n💰 Smoke financeiro — ADMIN_EMAILS=${ADMIN_EMAIL}\n`);

  const cleanup = { userIds: [] as string[], numberId: "" };
  try {
    // ── 1. Cadastro novo nasce suspenso ───────────────────────────────────
    console.log("① Cadastro novo nasce suspenso");
    const cli = await registerUser({
      name: "Cliente Smoke",
      email: uid("cli") + "@example.com",
      password: "12345678",
    });
    cleanup.userIds.push(cli.id);
    const cliRow = await prisma.user.findUnique({
      where: { id: cli.id },
      select: { billingActive: true },
    });
    check(
      "registerUser grava billingActive=false",
      cliRow?.billingActive === false,
      `billingActive=${cliRow?.billingActive}`,
    );

    const adm = await registerUser({
      name: "Admin Smoke",
      email: ADMIN_EMAIL,
      password: "12345678",
    });
    cleanup.userIds.push(adm.id);
    check("isAdminEmail reconhece a conta admin", isAdminEmail(ADMIN_EMAIL) === true);

    // ── 2. Trava: não suspende conta admin ────────────────────────────────
    console.log("\n② Trava de auto-suspensão do admin");
    let threw = false;
    let msg = "";
    try {
      await setAccountBilling(adm.id, false);
    } catch (e) {
      threw = true;
      msg = (e as Error).message;
    }
    check(
      "setAccountBilling recusa suspender admin",
      threw && /admin/i.test(msg),
      threw ? `erro: "${msg}"` : "NÃO lançou erro",
    );

    // ── 3. Toggle ativar/suspender conta comum ────────────────────────────
    console.log("\n③ Toggle ativar/suspender (conta comum)");
    const act = await setAccountBilling(cli.id, true);
    check("ativar → billingActive=true", act.billingActive === true);
    const susp = await setAccountBilling(cli.id, false);
    check("suspender → billingActive=false", susp.billingActive === false);

    // Número da conta de teste (para os gates).
    const num = await prisma.whatsAppNumber.create({
      data: {
        userId: cli.id,
        phone: uid("num"),
        sessionDir: uid("dir"),
        label: "SMOKE FIN",
        autoReplyEnabled: true,
      },
    });
    cleanup.numberId = num.id;
    const phone = "+5511" + Math.floor(100000000 + Math.random() * 8e8);

    // ── 4. Gate inbound: suspenso → IA silencia (mas persiste) ────────────
    console.log("\n④ Gate inbound (conta suspensa)");
    const r1 = await ingestInbound({
      whatsAppNumberId: num.id,
      phone,
      userId: cli.id,
      text: "olá, vocês atendem agora?",
      providerMessageId: uid("in1"),
    });
    check(
      "suspenso → respond=false",
      r1.respond === false && r1.leadId != null,
      `respond=${r1.respond} lead=${r1.leadId ? "criado" : "null"}`,
    );
    const inCount = await prisma.message.count({
      where: { leadId: r1.leadId!, direction: "INBOUND" },
    });
    check("suspenso → mensagem inbound FOI persistida", inCount >= 1, `INBOUND=${inCount}`);
    check(
      "isAccountActiveByLead(lead) = false (suspenso)",
      (await isAccountActiveByLead(r1.leadId!)) === false,
    );

    // ── 5. Reativar → inbound novo volta a responder ──────────────────────
    console.log("\n⑤ Reativação");
    await setAccountBilling(cli.id, true);
    const r2 = await ingestInbound({
      whatsAppNumberId: num.id,
      phone,
      userId: cli.id,
      text: "ainda está aí?",
      providerMessageId: uid("in2"),
    });
    check("reativado → respond=true (mensagem NOVA)", r2.respond === true, `respond=${r2.respond}`);
    check(
      "isAccountActiveByLead(lead) = true (ativo)",
      (await isAccountActiveByLead(r1.leadId!)) === true,
    );

    // ── 6. Gate outbound: claim ignora job de conta suspensa ──────────────
    console.log("\n⑥ Gate outbound (claim)");
    await setAccountBilling(cli.id, false); // suspende
    const job = await prisma.outboundJob.create({
      data: {
        leadId: r1.leadId!,
        kind: "freeform",
        content: "mensagem de teste (não enviada)",
        scheduledFor: new Date(Date.now() - 60_000),
      },
    });
    const claimSusp = await claimNextJobForAccount(cli.id, new Date());
    check("suspenso → claim retorna null", claimSusp === null, `claim=${claimSusp ?? "null"}`);
    const st1 = await prisma.outboundJob.findUnique({
      where: { id: job.id },
      select: { status: true },
    });
    check("suspenso → job permanece PENDING", st1?.status === "PENDING", `status=${st1?.status}`);

    await setAccountBilling(cli.id, true); // reativa
    const claimAct = await claimNextJobForAccount(cli.id, new Date());
    check("reativado → claim captura o job", claimAct === job.id, `claim=${claimAct ?? "null"}`);

    // ── 7. listAccountsForAdmin marca isAdmin ─────────────────────────────
    console.log("\n⑦ listAccountsForAdmin");
    const list = await listAccountsForAdmin();
    const cliRowL = list.find((a) => a.id === cli.id);
    const admRowL = list.find((a) => a.id === adm.id);
    check("lista conta comum com isAdmin=false", !!cliRowL && cliRowL.isAdmin === false);
    check("lista conta admin com isAdmin=true", !!admRowL && admRowL.isAdmin === true);
  } finally {
    // ── Limpeza ESCOPADA (só os dados de teste criados aqui) ──────────────
    console.log("\n🧹 Limpando dados de teste…");
    try {
      if (cleanup.userIds.length) {
        const leads = await prisma.lead.findMany({
          where: { userId: { in: cleanup.userIds } },
          select: { id: true },
        });
        const leadIds = leads.map((l) => l.id);
        if (leadIds.length) {
          await prisma.outboundJob.deleteMany({ where: { leadId: { in: leadIds } } });
          await prisma.message.deleteMany({ where: { leadId: { in: leadIds } } });
          await prisma.qualification.deleteMany({ where: { leadId: { in: leadIds } } });
          await prisma.meeting.deleteMany({ where: { leadId: { in: leadIds } } });
          await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
        }
        await prisma.whatsAppNumber.deleteMany({ where: { userId: { in: cleanup.userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
      }
      console.log("   ok.");
    } catch (e) {
      console.error("   ⚠️ falha na limpeza (limpe manualmente smoke-fin-*):", (e as Error).message);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n🏁 ${passed}/${results.length} checagens passaram${failed ? ` — ${failed} FALHARAM` : ""}.`);
  if (failed) process.exitCode = 1;
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
