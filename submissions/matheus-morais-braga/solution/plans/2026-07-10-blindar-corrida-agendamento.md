# Blindar corrida de agendamento (anti–duplo-booking) — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: use a skill `executing-plans` para implementar tarefa-a-tarefa.

**Goal:** Garantir que dois pedidos concorrentes nunca criem agendamentos sobrepostos no mesmo profissional — por QUALQUER caminho (link público, WhatsApp/IA, painel/recepção, série).

**Architecture:** Hoje só o `confirmBooking` (link + WhatsApp) tem trava anti-corrida, e ela é por **profissional + horário EXATO** — não pega horários diferentes que se sobrepõem (ex.: serviço de 60 min às 10:00 vs 10:15). Os caminhos de painel (`createAppointment`) e série (`createSeries`) não têm trava nenhuma e checam conflito FORA da transação do insert. A solução: uma única trava `pg_advisory_xact_lock` **por profissional** (não por horário), e garantir que **checagem-de-conflito + insert** rodem SEMPRE dentro da mesma transação que segura essa trava. Uma função helper concentra a chave da trava (DRY); os três caminhos passam a usá-la.

**Tech Stack:** TypeScript, Prisma (`$executeRaw` + advisory locks do Postgres), Vitest com Postgres real local (mesmo padrão dos testes de `order`/`appointment` — usa `DATABASE_URL` do `.env`).

**Por que advisory lock e não constraint no banco:** uma `EXCLUDE` constraint com `tstzrange` + `btree_gist` seria a blindagem "de ouro" (o banco recusa sobreposição em qualquer cenário), mas exige extensão + migração de schema com SQL cru (Prisma não modela `EXCLUDE`), é mais invasiva e tem risco em produção (Supabase). Como TODO acesso ao banco passa pelo app, a trava por profissional cobre 100% dos caminhos com custo e risco muito menores. A constraint fica como endurecimento **futuro/opcional** (fora de escopo).

**Contenção:** a trava é por profissional e vive só durante a transação (poucos ms: uma checagem + o insert). Agendamento é evento raro; o segundo pedido do MESMO profissional espera um instante. Desprezível.

**Pré-requisito de ambiente:** os testes são de integração (Postgres real). Rode com o Docker do banco de dev no ar (`DATABASE_URL` do `.env`), igual aos testes de `appointment.service.test.ts` que já existem.

**Nota sobre os testes de concorrência:** eles disparam dois pedidos com `Promise.allSettled` e afirmam que **exatamente um** entra. COM a trava isso é determinístico (a trava serializa). SEM a trava o teste falha (os dois inserem) — pode, raramente, passar por acaso se o SO serializar sozinho, mas com a trava passa sempre. É um bom guarda de regressão.

---

### Task 1: Trava por profissional (helper) + `confirmBooking`

Cria a fonte única da chave da trava e troca o `confirmBooking` para usá-la (de "profissional+horário" para "profissional"), fechando a janela de sobreposição no caminho link/WhatsApp.

**Files:**
- Modify: `src/server/services/appointment.service.ts` (adiciona o helper exportado `lockProfessionalForBooking`)
- Modify: `src/server/services/booking-availability.service.ts:301-307` (usa o helper)
- Test: `src/server/services/booking-availability.service.test.ts`

**Step 1: Escreva o teste que falha**

Adicione ao fim de `src/server/services/booking-availability.service.test.ts` (dentro do `describe` existente, ou num novo `describe("confirmBooking anti-corrida", ...)`). Reaproveite os helpers de seed já usados no arquivo (`makeOwner`/`makeProfessional`/`createCatalogItem` — se o arquivo não os tiver, copie do padrão de `appointment.service.test.ts`). Ajuste os imports conforme o arquivo.

```ts
it("dois confirmBooking SOBREPOSTOS (horários diferentes) no mesmo profissional: só um entra", async () => {
  const acc = await makeOwner();
  await prisma.user.update({ where: { id: acc }, data: { bookingEnabled: true } });
  const pro = await makeProfessional(acc);
  const item = await createCatalogItem(acc, { name: "Corte 60", priceCents: 5000 });
  await prisma.catalogItem.update({ where: { id: item.id }, data: { durationMinutes: 60 } });

  // 3h à frente (> bookingLeadMinutes=120, < horizonte=30d). 13:00 e 13:30 se
  // sobrepõem (serviço de 60 min): 13:00–14:00 x 13:30–14:30.
  const day = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const isoAt = (h: number, m: number) => {
    const d = new Date(day); d.setUTCHours(h, m, 0, 0); return d.toISOString();
  };
  const mk = (startISO: string) =>
    confirmBooking(acc, {
      catalogItemId: item.id,
      professionalId: pro,
      startISO,
      customerName: "Cliente",
      customerPhone: "+5511999990000",
    });

  const results = await Promise.allSettled([mk(isoAt(13, 0)), mk(isoAt(13, 30))]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");
  expect(ok).toHaveLength(1);
  expect(failed).toHaveLength(1);
  expect((failed[0] as PromiseRejectedResult).reason.message).toMatch(/CONFLICT/);

  // E só existe UM agendamento ativo para o profissional
  const count = await prisma.appointment.count({
    where: { professionalId: pro, status: { in: ["AGENDADO", "CONFIRMADO"] } },
  });
  expect(count).toBe(1);
});
```

> Se `confirmBooking`/`makeOwner`/`makeProfessional`/`createCatalogItem` não estiverem importados no arquivo, adicione os imports (veja o topo de `booking-availability.service.test.ts` e `appointment.service.test.ts`).

**Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/server/services/booking-availability.service.test.ts -t "SOBREPOSTOS"`
Expected: FAIL — hoje entram DOIS agendamentos (`ok` tem 2 / `count` = 2), porque a trava é por horário exato e 13:00 ≠ 13:30.

**Step 3: Adicione o helper da trava (fonte única da chave)**

Em `src/server/services/appointment.service.ts`, logo após o bloco de `type Db = Prisma.TransactionClient;` (perto do topo), adicione:

```ts
/**
 * Trava anti-corrida de agendamento, POR PROFISSIONAL (não por horário exato).
 * Serializa QUALQUER criação no mesmo profissional dentro da transação — fecha a
 * janela em que dois horários DIFERENTES que se sobrepõem (ex.: serviço de 60 min
 * às 10:00 vs 10:15) passariam ambos na checagem. Vive até o commit; contenção
 * desprezível (agendamento é raro, transação curta). `hashtext` → int4, cabe no
 * bigint do advisory lock. Chave única: use SEMPRE este helper (nunca monte a chave
 * na mão), senão dois caminhos travam em chaves diferentes e não serializam.
 */
export async function lockProfessionalForBooking(
  tx: Prisma.TransactionClient,
  professionalId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking|${professionalId}`}))`;
}
```

**Step 4: Troque a trava do `confirmBooking`**

Em `src/server/services/booking-availability.service.ts`:

1. No import de `./appointment.service`, adicione `lockProfessionalForBooking`:

```ts
import { conflictsFor, createAppointment, lockProfessionalForBooking } from "./appointment.service";
```

2. Substitua (linhas ~301-307):

```ts
  // 2. guarda anti-corrida + 3./4. resolve cliente e cria — tudo sob a trava do slot.
  const lockKey = `booking|${input.professionalId}|${input.startISO}`;
  const created = await prisma.$transaction(async (tx) => {
    // A trava vive até o fim da transação: enquanto este confirm roda, outro no
    // MESMO slot fica bloqueado aqui — quando destrava, já vê o agendamento e cai
    // no CONFLICT. `hashtext` → int4 (cabe no bigint do advisory lock).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
```

por:

```ts
  // 2. guarda anti-corrida + 3./4. resolve cliente e cria — tudo sob a trava do slot.
  const created = await prisma.$transaction(async (tx) => {
    // Trava POR PROFISSIONAL: enquanto este confirm roda, QUALQUER outro pedido no
    // mesmo profissional (mesmo horário OU horário sobreposto) espera aqui; quando
    // destrava, a recheca de conflito abaixo já vê o agendamento e cai no CONFLICT.
    await lockProfessionalForBooking(tx, input.professionalId);
```

**Step 5: Rode o teste e confirme que passa**

Run: `npx vitest run src/server/services/booking-availability.service.test.ts -t "SOBREPOSTOS"`
Expected: PASS — exatamente um entra, o outro rejeita com `CONFLICT`, `count` = 1.

**Step 6: Rode o arquivo inteiro (não regrediu nada)**

Run: `npx vitest run src/server/services/booking-availability.service.test.ts`
Expected: PASS (todos).

**Step 7: Commit**

```bash
git add src/server/services/appointment.service.ts src/server/services/booking-availability.service.ts src/server/services/booking-availability.service.test.ts
git commit -m "fix(agendamento): trava anti-corrida por profissional no confirmBooking (fecha sobreposição)"
```

---

### Task 2: `createAppointment` — trava + checagem atômica com o insert

O caminho do painel/recepção não tem trava e checa conflito FORA da transação do insert. Passa a adquirir a trava por profissional e a rodar `assertSlotFree` DENTRO da transação que insere.

**Files:**
- Modify: `src/server/services/appointment.service.ts:304-372` (função `createAppointment`)
- Test: `src/server/services/appointment.service.test.ts`

**Step 1: Escreva os testes que falham**

Adicione em `src/server/services/appointment.service.test.ts` (usa `makeOwner`/`makeLead`/`makeProfessional`/`createCatalogItem` já presentes):

```ts
it("dois createAppointment SOBREPOSTOS no mesmo profissional: só um entra (concorrência)", async () => {
  const acc = await makeOwner();
  const leadId = await makeLead(acc, "+5511900000801");
  const pro = await makeProfessional(acc);
  const item = await createCatalogItem(acc, { name: "Corte 60", priceCents: 5000 });
  await prisma.catalogItem.update({ where: { id: item.id }, data: { durationMinutes: 60 } });

  const base = {
    leadId, catalogItemId: item.id, professionalId: pro, createdById: acc,
    force: true, // sem expediente cadastrado: pula a checagem de horário
  };
  // 13:00–14:00 x 13:30–14:30 se sobrepõem
  const a = createAppointment(acc, { ...base, scheduledAt: new Date("2026-09-01T13:00:00.000Z") });
  const b = createAppointment(acc, { ...base, scheduledAt: new Date("2026-09-01T13:30:00.000Z") });
  const results = await Promise.allSettled([a, b]);

  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  expect(failed).toHaveLength(1);
  expect(failed[0].reason.message).toMatch(/CONFLICT/);
  const count = await prisma.appointment.count({ where: { professionalId: pro } });
  expect(count).toBe(1);
});

it("createAppointment sobreposto a um já existente: CONFLICT (sequencial)", async () => {
  const acc = await makeOwner();
  const leadId = await makeLead(acc, "+5511900000802");
  const pro = await makeProfessional(acc);
  const item = await createCatalogItem(acc, { name: "Corte 60", priceCents: 5000 });
  await prisma.catalogItem.update({ where: { id: item.id }, data: { durationMinutes: 60 } });
  const base = { leadId, catalogItemId: item.id, professionalId: pro, createdById: acc, force: true };

  await createAppointment(acc, { ...base, scheduledAt: new Date("2026-09-02T13:00:00.000Z") });
  await expect(
    createAppointment(acc, { ...base, scheduledAt: new Date("2026-09-02T13:30:00.000Z") }),
  ).rejects.toThrow(/CONFLICT/);
});
```

**Step 2: Rode e confirme que falha**

Run: `npx vitest run src/server/services/appointment.service.test.ts -t "SOBREPOSTOS no mesmo profissional"`
Expected: FAIL — hoje entram os dois (`count` = 2), pois a checagem é fora da transação e não há trava.

> O segundo teste (sequencial) já PASSA hoje — `conflictsFor` detecta sobreposição quando o primeiro já está commitado. Ele fica como documentação/guarda da regra de sobreposição.

**Step 3: Reestruture `createAppointment`**

Em `src/server/services/appointment.service.ts`, substitua o corpo a partir das validações até o `return` (o trecho que hoje faz `if (input.professionalId) { assertProfessionalOwned + assertSlotFree }` FORA da transação e depois `const run = ...`):

```ts
  const db = tx ?? prisma;
  const scope = await resolveScope(userId, input, db);
  const { catalogItemId, serviceName } = await resolveServiceName(
    userId,
    input.catalogItemId,
    input.serviceName,
    db,
  );
  const durationMinutes = await resolveDuration(userId, catalogItemId, input.durationMinutes, db);
  if (input.professionalId) {
    await assertProfessionalOwned(userId, input.professionalId, db);
  }
  // Trava + checagem de slot + insert ATÔMICOS na MESMA transação: sem isso, dois
  // pedidos concorrentes passam ambos na checagem (feita antes do insert) e criam
  // sobreposição. A trava é por profissional (fecha horários diferentes que se cruzam).
  const run = async (client: Prisma.TransactionClient) => {
    if (input.professionalId) {
      await lockProfessionalForBooking(client, input.professionalId);
      await assertSlotFree(
        userId,
        input.professionalId,
        input.scheduledAt,
        durationMinutes,
        { allowOverlap: input.allowOverlap, force: input.force },
        client,
      );
    }
    return client.appointment.create({
      data: {
        leadId: scope.leadId,
        accountId: scope.accountId,
        customerName: scope.customerName,
        customerPhone: scope.customerPhone,
        scheduledAt: input.scheduledAt,
        catalogItemId,
        serviceName,
        durationMinutes,
        professionalId: input.professionalId ?? null,
        note: input.note?.trim() || null,
        createdById: input.createdById,
        number: await reserveAppointmentNumbers(client, userId),
        ...(input.source ? { source: input.source } : {}),
      },
    });
  };
  return tx ? run(tx) : prisma.$transaction(run);
```

> Observação: quando `confirmBooking` chama `createAppointment(tx)`, a trava é readquirida na MESMA transação (mesma chave) — isso é seguro no Postgres (a transação já a segura; readquirir é imediato) e a `assertSlotFree` extra é redundante mas inofensiva.

**Step 4: Rode e confirme que passa**

Run: `npx vitest run src/server/services/appointment.service.test.ts -t "createAppointment"`
Expected: PASS (concorrência = 1 entra; sequencial = CONFLICT).

**Step 5: Rode o arquivo inteiro**

Run: `npx vitest run src/server/services/appointment.service.test.ts`
Expected: PASS (todos — inclusive os testes de número sequencial e de conflito já existentes).

**Step 6: Commit**

```bash
git add src/server/services/appointment.service.ts src/server/services/appointment.service.test.ts
git commit -m "fix(agendamento): createAppointment trava+checa slot dentro da transação do insert"
```

---

### Task 3: `createSeries` — trava + checagem dentro da transação

A série checa conflito FORA da transação e não tem trava. Passa a adquirir a trava por profissional e checar cada sessão DENTRO da transação que grava a série.

**Files:**
- Modify: `src/server/services/appointment.service.ts:383-446` (função `createSeries`)
- Test: `src/server/services/appointment.service.test.ts`

**Step 1: Escreva o teste que falha**

```ts
it("createSeries que sobrepõe agendamento existente: CONFLICT e NADA é criado (rollback)", async () => {
  const acc = await makeOwner();
  const leadId = await makeLead(acc, "+5511900000803");
  const pro = await makeProfessional(acc);
  const item = await createCatalogItem(acc, { name: "Sessão 60", priceCents: 5000 });
  await prisma.catalogItem.update({ where: { id: item.id }, data: { durationMinutes: 60 } });
  const base = { leadId, catalogItemId: item.id, professionalId: pro, createdById: acc, force: true };

  // Ocupa a 2ª data da futura série (semana +1), sobrepondo por horário diferente
  await createAppointment(acc, { ...base, scheduledAt: new Date("2026-09-08T13:30:00.000Z") });
  const before = await prisma.appointment.count({ where: { professionalId: pro } });

  await expect(
    createSeries(
      acc,
      { ...base, scheduledAt: new Date("2026-09-01T13:00:00.000Z") },
      { everyDays: 7, count: 3 }, // 01/09, 08/09 (colide), 15/09
    ),
  ).rejects.toThrow(/CONFLICT/);

  // Rollback: a série inteira aborta, nenhuma sessão nova entra
  const after = await prisma.appointment.count({ where: { professionalId: pro } });
  expect(after).toBe(before);
});
```

**Step 2: Rode e confirme o estado atual**

Run: `npx vitest run src/server/services/appointment.service.test.ts -t "createSeries que sobrepõe"`
Expected: PASS (o `CONFLICT` já é detectado hoje na checagem pré-transação). Este teste **fixa o comportamento** para não regredir quando movermos a checagem para dentro da transação. (A blindagem de concorrência da série vem da trava; a corrida série×série é rara e o teste determinístico dela seria flaky — cobrimos o invariante "checa sob a trava, dentro da transação".)

**Step 3: Reestruture `createSeries`**

Em `src/server/services/appointment.service.ts`, substitua o bloco que hoje faz o `if (base.professionalId) { assertProfessionalOwned + for(...) checa }` FORA da transação e depois `return prisma.$transaction(...)` por:

```ts
  if (base.professionalId) {
    await assertProfessionalOwned(userId, base.professionalId);
  }

  // Numeração sequencial (Onda M) sob advisory lock: a série reserva `count` números
  // contíguos e cria tudo na mesma transação (ou entra inteira, ou nada). A checagem
  // de conflito por sessão roda AQUI DENTRO, sob a trava por profissional — atômica
  // com o createMany (sem isso, dois pedidos concorrentes passariam ambos na checagem).
  return prisma.$transaction(async (tx) => {
    if (base.professionalId) {
      const profId = base.professionalId;
      await lockProfessionalForBooking(tx, profId);
      for (const at of sessions) {
        const end = appointmentEnd(at, durationMinutes);
        if (!base.allowOverlap) {
          const conflicts = await conflictsFor(userId, profId, at, end, undefined, tx);
          if (conflicts.length > 0) {
            throw new Error(
              `CONFLICT: Profissional já tem agendamento em ${formatSlot(at.toISOString(), TZ)}.`,
            );
          }
        }
        if (!base.force && (await isOutsideWorkingHours(userId, profId, at, end, tx))) {
          throw new Error("OUTSIDE_HOURS: Fora do horário de funcionamento do profissional.");
        }
      }
    }
    const startNumber = await reserveAppointmentNumbers(tx, userId);
    const rows: Prisma.AppointmentCreateManyInput[] = sessions.map((at, i) => ({
      leadId: scope.leadId,
      accountId: scope.accountId,
      customerName: scope.customerName,
      customerPhone: scope.customerPhone,
      scheduledAt: at,
      catalogItemId,
      serviceName,
      durationMinutes,
      professionalId: base.professionalId ?? null,
      note: base.note?.trim() || null,
      seriesId,
      createdById: base.createdById,
      number: startNumber + i,
    }));
    await tx.appointment.createMany({ data: rows });
    return { seriesId, count };
  });
```

**Step 4: Rode e confirme que passa**

Run: `npx vitest run src/server/services/appointment.service.test.ts -t "createSeries"`
Expected: PASS (série que colide → CONFLICT + rollback; e os testes de série já existentes continuam verdes).

**Step 5: Commit**

```bash
git add src/server/services/appointment.service.ts src/server/services/appointment.service.test.ts
git commit -m "fix(agendamento): createSeries checa conflito sob a trava por profissional, dentro da transação"
```

---

### Task 4: Verificação final (typecheck + lint + suíte)

**Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem saída (0 erros).

**Step 2: Lint dos arquivos tocados**

Run: `npx eslint src/server/services/appointment.service.ts src/server/services/booking-availability.service.ts src/server/services/appointment.service.test.ts src/server/services/booking-availability.service.test.ts`
Expected: sem saída.

**Step 3: Suíte dos serviços afetados (inclui a regressão do pool)**

Run: `npx vitest run src/server/services/appointment.service.test.ts src/server/services/booking-availability.service.test.ts src/server/services/booking-availability.pool.test.ts`
Expected: PASS (todos).

**Step 4: Commit final (se algo faltou)**

```bash
git add -A
git commit -m "test(agendamento): fecha verificação da blindagem anti-corrida" || echo "nada a commitar"
```

---

## Fora de escopo (endurecimento futuro, opcional)

- **Constraint `EXCLUDE` no Postgres** (blindagem no banco, independente do app): `CREATE EXTENSION btree_gist;` + coluna/expressão `tstzrange(scheduledAt, scheduledAt + durationMinutes*interval)` com `EXCLUDE USING gist (professionalId WITH =, range WITH &&) WHERE (status IN ('AGENDADO','CONFIRMADO'))`. É a garantia mais forte, mas exige SQL cru (Prisma não modela `EXCLUDE`), extensão e migração — avaliar risco em produção (Supabase) antes. A trava por profissional já cobre todos os caminhos do app.
- **Reduzir contenção** (se algum dia a trava por profissional pesar): chavear por `booking|{professionalId}|{YYYY-MM-DD}` (por profissional-dia). Só vale se houver volume alto de agendamentos simultâneos por profissional — hoje é over-engineering (YAGNI).
