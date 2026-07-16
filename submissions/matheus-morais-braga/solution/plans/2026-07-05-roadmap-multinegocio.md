# Roadmap Multinegócio — do "atende" ao "opera o negócio"

> **Documento-mestre.** NÃO é um plano de execução task-by-task — é o **guarda-chuva** que
> sequencia as iniciativas, é **dono da ordem das migrations** e das ondas de release, e aponta
> para os planos de execução separados (um por iniciativa). Cada plano filho referencia este.

**Tese:** o motor de atendimento por IA/WhatsApp já é forte (multi-número, multiatendimento,
qualificação, agendamento, Pix, 63 modelos de negócio). O que trava a entrada real em varejo,
alimentação e serviços presenciais é a **camada de operação do balcão** — comanda/caixa sem
impressão nem desconto, agenda que não sabe qual profissional atende, sem sessão de caixa, sem
fiscal. Os 63 modelos de IA "prometem" atender barbearia/restaurante/oficina, mas a operação
não paga o cheque. Este roadmap fecha essa distância.

---

## Princípios (valem para todos os planos filhos)

- **Convenção de plano:** cada iniciativa vira um arquivo próprio em `docs/plans/`, no formato
  TDD task-by-task (ver `2026-07-05-confirmacao-automatica-agendamento.md` como referência de
  estilo). Este mestre só coordena.
- **PROD tem schema drift** ([[prod-schema-drift-destravar]]): dev usa `prisma db push`; PROD
  **não** roda `migrate` — toda coluna/tabela nova ganha um `prisma/manual/*.sql` **idempotente**
  (`IF NOT EXISTS`) aplicado no Supabase SQL Editor pelo dono. As **ondas de migration** abaixo
  agrupam essas mudanças para não colidirem entre planos executados em paralelo.
- **Dinheiro em centavos** (`Int`), `parseBRLToCents`/`formatCentsBRL` só na borda ([[caixa-despesas-reposicionamento]]).
- **Opt-in por conta/item** sempre que possível: nada novo pode poluir os ~50 modelos de serviço
  puro (padrão já usado em estoque — `trackStock`).
- **Tema:** só tokens/CSS vars, nunca hex fixo ([[design-tokens-dark-theme]]).
- **Tenancy:** dono = `ctx.tenantUserId`; operador = `ctx.sessionUserId`; tudo escopado por conta.

---

## Mapa de iniciativas → plano filho

| # | Iniciativa | Onda | Prioridade | Plano filho (a criar) |
|---|---|---|---|---|
| 1 | Impressão de comanda/recibo (N1 navegador · N2 ESC/POS · N3 cozinha) | A | **P0** | `2026-07-05-impressao-comanda.md` — **FEITO N1+N2+N3 (PROD ✅ 2026-07-05)** |
| 2 | POS financeiro (desconto, acréscimo/taxa, gorjeta, troco, qtd editável, multi-pagamento) | A | **P0** | `2026-07-05-pos-financeiro.md` — **FEITO (PROD ✅ 2026-07-05)** |
| 3 | Sessão de caixa (abrir/fechar, fundo de troco, sangria/suprimento, conferência) | B | **P1** | `2026-07-06-sessao-de-caixa.md` — **FEITO (PROD ✅ 2026-07-05)** |
| 4 | Estorno / reabertura de comanda (reverte baixa de estoque) | B | **P1** | `2026-07-06-estorno-comanda.md` — **FEITO (PROD ✅ 2026-07-05)** |

> **Ondas A e B aplicadas em PROD em 2026-07-05** (`onda-a.sql` + `onda-b.sql` rodados no Supabase; código deployado via Vercel CLI). NÃO reaplicar o SQL.
>
> ¹ **Iniciativas 5, 6, 7 = FEITO em dev** (models no schema + `onda-c/d/e.sql` + código/testes, tudo committado). **PROD não confirmado**: falta verificar se `onda-c.sql`/`onda-d.sql`/`onda-e.sql` foram aplicados no Supabase e se o código foi deployado no Vercel. Confirmar e, quando aplicado, trocar para `PROD ✅`. (Reconciliado por verificação do repo — os chats que implementaram não atualizaram este mestre.)
>
> ³ **Iniciativa 11 = plano escrito** (`2026-07-10-verticais-unificadas.md`). **Não acrescenta schema à Onda D**
> (nem a nenhuma outra): é conteúdo (`business-templates.ts` + `theme/presets.ts`) + orquestração que reusa
> colunas/serviços existentes (`User.businessTemplateId`/`pipelineLabels`, `AccountBranding.presetId`,
> `CustomFieldDef`, `CatalogItem`, `Offer`). **Sem `prisma/manual/*.sql`, sem `db push` — PROD = só deploy de código.**
>
> ² **Iniciativa 10 = FEITO em dev** (`db push` local + testes verdes + E2E do toggle). **PROD pendente**: aplicar a seção da iniciativa 10 do `onda-e.sql` no Supabase (idempotente, `IF NOT EXISTS` — pode aplicar o arquivo inteiro), deploy web (leva a toggle) + `git pull`/restart do worker (leva o tick, sobe inerte). Ligar **gradual**: `LIFECYCLE_AUTOMATION=true` + `LIFECYCLE_POSTSALE_HOURS=2` numa conta piloto com opt-in → depois NPS → **reengajamento por último** (cold-ish).
>
> ⁴ **Iniciativa 12 = FEITO em dev** (`2026-07-11-catalogo-estoque-avancado.md`; 8 commits em master, gate verde 792 testes, tsc+lint limpos). **PROD**: `onda-g.sql` **JÁ aplicado e confirmado** (3 colunas + 2 índices); falta só deploy do código (Vercel CLI). **Onda G composta**: além do previsto
> `CatalogItem.barcode` (12.2), o plano resolve a variação como **SKU flat** — `CatalogItem.variantGroup` (rótulo de
> grade; **`ItemVariant` relacional ADIADO** por reuso total do estoque/venda por linha) — e adiciona **`OrderItem.unitCostCents`**
> (*desvio consciente:* snapshot de custo por linha p/ a **margem realizada**, no mesmo padrão de `commissionCents`, já que
> o custo do catálogo muda e o item pode ser excluído). Valorização/margem potencial reusam `CatalogItem.costCents` (**sem
> schema**). Um único `prisma/manual/2026-07-11-onda-g.sql` idempotente; PROD = SQL + deploy de código.
>
> ⁵ **Iniciativa 13 = plano escrito** (`2026-07-12-fiscal-nfce.md`). **Onda H isolada** (nenhuma outra iniciativa
> compõe). Emissão de **NFC-e (modelo 65)** via **emissor terceiro** (Focus NFe/PlugNotas/Tecnospeed) com credencial
> **BYOK cifrada** ([[strong-model-byok-only]]), **opt-in por conta** e **assíncrona no worker** (SEFAZ é lento — nunca
> trava o fechamento). **Duas chaves** p/ emitir (kill-switch `FISCAL_EMISSION` + `User.fiscalEnabled`), sobe **inerte**
> — padrão da automação de ciclo de vida. **Onda H > o previsto** (*desvios conscientes*): além de `Order.fiscalStatus`/
> `fiscalDocId`, o plano adiciona `fiscalKey`/`fiscalDanfeUrl` (reimpressão do DANFE), `fiscalError`, `fiscalRequestedAt`/
> `fiscalIssuedAt`/`fiscalAttempts` (retry/backoff), e em `User` o perfil fiscal mínimo (`fiscalEnv` homologação/produção,
> `fiscalSerie`, `fiscalCnpj`, `fiscalDefaultNcm`/`fiscalDefaultCfop`) — o cadastro tributário pesado mora **no emissor**.
> **Classificação tributária por item (`CatalogItem.ncm/cfop`) ADIADA** (v1 usa NCM/CFOP padrão da conta). Um único
> `prisma/manual/2026-07-12-onda-h.sql` (enums novos com guarda por `DO $$ … EXCEPTION`); PROD = SQL + deploy + `ENCRYPTION_KEY` no worker.
>
> ⁶ **Iniciativa 14 = FEITO em dev** (`2026-07-13-reorganizacao-navegacao.md`; commits em master; gate verde, 835 testes,
> tsc limpo). **Sem schema** — só front-end/roteamento. A navegação virou **dado puro testável**: `buildNav(ctx)` +
> `moduleVisibleFor(category, key)` em `src/lib/nav.ts` (o `Sidebar` só renderiza). Menu reagrupado em 5 (**Operação /
> Clientes / Catálogo & Estoque / Financeiro / Conta**) com renomes (item **Atendimento**; billing SaaS → **Administração**).
> Catálogo/Estoque/Relatórios/Despesas **viraram rotas próprias** (Caixa vira PDV puro); a config de cada módulo **mora no
> módulo** (Agenda: profissionais/horários/comissão/link; Atendimento: `/inbox/config`; Caixa: impressão) e `Configurações`
> ficou só com o global. Nav **adaptável ao ramo** é **fail-open**: módulos fora do ramo caem num grupo **"Mais"** colapsável
> (nada some). **Desvios conscientes:** o **fiscal (NFC-e)** ficou em `AccountSettings`/Configurações (acoplado ao BYOK — não
> extraído p/ o Caixa); **Produção** segue hard-gate (ausente fora de alimentação, não em "Mais"). **PROD = só deploy de código.**
| 5 | Agenda Pro (profissional/recurso + duração por serviço + visão calendário + conflito) | C | **P1** | `2026-07-07-agenda-profissional.md` — **FEITO (dev)** ¹ |
| 6 | Respostas rápidas + SLA + notas internas/anti-colisão (inbox) | D | **P1** | `2026-07-07-inbox-produtividade.md` — **FEITO (dev)** ¹ |
| 7 | IA tool-calling (criar comanda, consultar estoque, enviar catálogo/mídia, escalar) | E | **P2** | `2026-07-08-ia-tool-calling.md` — **FEITO (dev)** ¹ (gated por flag) |
| 8 | Auto-agendamento online (link público) | F | **P2** | `2026-07-09-agendamento-online.md` — **plano escrito, pronto p/ executar** (depende de 5, já em dev) |
| 9 | Comissão por profissional | F | **P2** | `2026-07-09-comissao.md` — **FEITO (dev)** ¹ (motor puro + CRUD + snapshot no fechamento + relatório + UI; `onda-f.sql` composto, PROD a aplicar) |
| 10 | Automação de ciclo de vida (pós-venda, NPS/avaliação, reengajamento de frio) | E | **P2** | `2026-07-08-automacao-ciclo-vida.md` — **FEITO (dev)** ² (motor puro + serviço idempotente + tick no worker + opt-in por conta na UI; `onda-e.sql` composto/append, PROD a aplicar; sobe **inerte** — off até `LIFECYCLE_AUTOMATION`=true **e** opt-in da conta) |
| 11 | Verticais unificadas (onboarding único, presets de campo/oferta, temas faltantes) | D (**sem schema**) | **P3** | `2026-07-10-verticais-unificadas.md` — **FEITO (dev)** ³ (conteúdo + wizard de orquestração; 10 commits em master; gate verde 780 testes; **PROD = só deploy de código**) |
| 12 | Catálogo/estoque++ (variações, código de barras/EAN, valorização, margem) | G | **P3** | `2026-07-11-catalogo-estoque-avancado.md` — **FEITO (dev)** ⁴ (valorização/margem + bipar + grade SKU flat; 8 commits em master; gate verde 792 testes; `onda-g.sql` **JÁ aplicado em PROD**, código a deployar) |
| 13 | Fiscal NFC-e via emissor terceiro (opt-in por conta) | H | **P3** | `2026-07-12-fiscal-nfce.md` — **plano escrito, pronto p/ executar** ⁵ |
| 14 | Reorganização da navegação / IA do dashboard (sidebar por rotina + config no módulo + nav por ramo) | — (**sem schema**, só front-end) | **P2** | `2026-07-13-reorganizacao-navegacao.md` — **FEITO (dev)** ⁶ (`buildNav`/`moduleVisibleFor` puros + testáveis; 5 grupos novos + renomes; catálogo/estoque/relatórios/despesas viram rotas; config de cada módulo mora no módulo; grupo "Mais" por ramo; **PROD = só deploy de código**) |
| 15 | Admin da plataforma em conta própria (separa god-mode do negócio; cartório vira conta normal) | — (config/dados via `ADMIN_EMAILS` + `billingOverride`, sem schema) | **P2** | `2026-07-14-admin-conta-propria.md` — **runbook escrito, pronto p/ executar** |

---

## Ondas de migration (schema coordenado — leia antes de qualquer plano filho)

Cada onda = **um** `prisma/manual/AAAA-MM-DD-<onda>.sql` idempotente. Planos da mesma onda que
tocam o schema **compõem** o mesmo arquivo (como estoque×despesas já fizeram). Ordem obrigatória:

- **Onda A** (iniciativas 1–2): em `Order` → `discountCents Int?`, `surchargeCents Int?`,
  `tipCents Int?`, `amountTenderedCents Int?`, `changeCents Int?`, `number Int?` (sequencial por
  conta), `tableLabel String?`. Novo model **`OrderTender`** (pagamento multi-meio: N linhas por
  comanda, `method OrderPayment`, `amountCents`). Em `CatalogItem` → `printSector String?`
  (cozinha/bar/balcão, p/ N3). *O enum `OrderPayment` já existe — reusar, não recriar.*
- **Onda B** (iniciativas 3–4): novos models **`CashSession`** (abertura/fechamento, `openingFloatCents`,
  `closingCountedCents`, `openedById`/`closedById`, `status`) e **`CashMovement`** (`SANGRIA`/`SUPRIMENTO`,
  `amountCents`, `reason`). `Order.cashSessionId String?`. `OrderStatus` ganha valor `CANCELADA`
  (estorno) — *enum alterado exige `ALTER TYPE ... ADD VALUE IF NOT EXISTS` no SQL manual.*
- **Onda C** (iniciativa 5): novo model **`Professional`** (nome, ativo, `color`, vínculo a `User`
  membro opcional). `Appointment.professionalId String?`. `CatalogItem.durationMinutes Int?`. Novo
  model **`WorkingHours`** (por profissional/conta: dia da semana, início, fim, intervalo).
- **Onda D** (iniciativa 6): novo model **`QuickReply`** (snippet por conta, `title`, `body`,
  `shortcut`). Novo model **`InternalNote`** (nota de operador na conversa/lead). *SLA reusa
  `queuedAt`/`firstResponseAt` já existentes — sem coluna nova.* **A iniciativa 11 estava listada nesta
  onda, mas NÃO acrescenta schema** — é conteúdo + orquestração sobre colunas existentes (ver plano filho
  e nota ³). A Onda D fica sendo só o schema da iniciativa 6.
- **Onda E** (iniciativas 7, 10): a iniciativa 7 (tool-calling) refatora serviço + `MediaAsset` +
  `WhatsAppNumber.aiToolCallingEnabled` (**dona** do `prisma/manual/2026-07-08-onda-e.sql`). A iniciativa
  10 (automação) **acrescenta** ao mesmo arquivo (append idempotente) — *desvio consciente do "sem schema
  novo"*: além do previsto `Lead.lastEngagedAt` (throttle de reengajamento), também `Order.postSaleThankedAt`/
  `Order.reviewRequestedAt` (marcadores de idempotência do pós-venda/NPS, padrão `remindedDayBeforeAt`) e
  `User.lifecycleAutomationEnabled` (opt-in por conta — sem ele um flag global mandaria mensagem ao cliente
  de toda conta no multi-tenant). Detalhe em `2026-07-08-automacao-ciclo-vida.md`.
- **Onda F** (iniciativas 8, 9): **um** `prisma/manual/2026-07-09-onda-f.sql` idempotente e composto.
  Iniciativa 8 (agendamento online) adiciona colunas em `User`: `publicSlug String? @unique` (link
  público) + `bookingEnabled Boolean` + config de slot (`bookingLeadMinutes`/`bookingHorizonDays`/
  `bookingSlotStep`) — o slug é **identidade de roteamento**, mora no `User` (não no branding, que só
  fornece cor/logo/appName à página pública). Iniciativa 9 (comissão) **acrescenta** ao mesmo arquivo
  **`CommissionRule`** (por profissional/serviço, `percentBps` pontos-base OU `fixedCents`) e, em
  `OrderItem`, **`commissionCents`** + **`professionalId`** (ambos snapshot no fechamento). *Desvio
  consciente:* o mestre listava só `commissionCents`, mas o snapshot inclui também `professionalId`
  (profissional creditado por linha) — sem ele o relatório teria de re-derivar o profissional do
  agendamento em leitura (frágil: agendamento pode sumir; comanda avulsa não tem agendamento). Depende
  de `Professional`/`WorkingHours`/`durationMinutes` (Onda C).
- **Onda G** (iniciativa 12): **um** `prisma/manual/2026-07-11-onda-g.sql` idempotente e composto pelas 3 fases.
  `CatalogItem.barcode String?` (**`@@unique([accountId, barcode])`** — NULLs coexistem, padrão de `Order.number`).
  **Decisão do plano filho: SKU flat** — `CatalogItem.variantGroup String?` (rótulo de grade; variação = outra
  `CatalogItem` agrupada) — o model **`ItemVariant`** relacional fica **ADIADO** (reusa 100% do estoque/venda/barcode
  por linha; promover só se surgir demanda por matriz cor×tamanho). *Desvio consciente:* também **`OrderItem.unitCostCents`**
  (snapshot de custo por linha no fechamento, p/ a **margem realizada** — o mestre não previa, mas segue o padrão de
  `commissionCents`/`professionalId`: custo do catálogo muda e o item pode ser excluído, então re-derivar ao vivo é frágil).
  A **valorização** e a **margem potencial** reusam `CatalogItem.costCents` já existente — sem schema.
- **Onda H** (iniciativa 13): **um** `prisma/manual/2026-07-12-onda-h.sql` idempotente e **isolado** (nenhuma
  outra iniciativa compõe). **Enums novos** `FiscalProvider`/`FiscalEnv`/`FiscalStatus` — como `CREATE TYPE`
  **não** tem `IF NOT EXISTS`, cada um vai num guard `DO $$ BEGIN CREATE TYPE … EXCEPTION WHEN duplicate_object
  THEN null; END $$;` (≠ `ALTER TYPE … ADD VALUE` do estorno). Em `User`: credencial BYOK do emissor cifrada
  (`fiscalProvider`, `fiscalKeyEnc`, `fiscalKeyLast4`, `fiscalKeyVerifiedAt` — padrão de `paymentKeyEnc`,
  [[strong-model-byok-only]]) + **perfil fiscal mínimo** (`fiscalEnabled` opt-in, `fiscalEnv`
  homologação/produção, `fiscalSerie`, `fiscalCnpj`, `fiscalDefaultNcm`, `fiscalDefaultCfop`). Em `Order`:
  `fiscalStatus`, `fiscalDocId` (previstos) **+** *desvios conscientes* `fiscalKey`/`fiscalDanfeUrl` (chave de
  acesso + URL do DANFE p/ reimpressão), `fiscalError`, `fiscalRequestedAt`/`fiscalIssuedAt`, `fiscalAttempts`
  (retry/backoff) e `@@index([accountId, fiscalStatus])` (o worker varre pendentes). **Classificação
  tributária por item (`CatalogItem.ncm/cfop`) ADIADA** (v1 usa NCM/CFOP padrão da conta ou a regra do
  emissor). Detalhe em `2026-07-12-fiscal-nfce.md`.

> Regra de ouro: **nunca** rode SQL manual redundante com uma migration versionada na mesma
> mudança — colisão vira P3018→P3009 e trava deploy ([[prod-schema-drift-destravar]]). Em dev é
> `db push`; em PROD é só o `manual/*.sql` idempotente até o cutover para `migrate deploy`
> ([[crm-inbox-db-push-pending]]).

---

## Ondas de release (o "em fases" macro)

### Release 1 — "Balcão que funciona" (Ondas A + B) · P0/P1
Destrava **todo negócio com balcão** (varejo, alimentação, serviço com venda). Entregáveis:
1. **Impressão N1** (recibo/comanda em bobina 80/58mm via navegador + reimpressão do extrato).
2. **POS financeiro**: desconto, acréscimo/taxa de serviço, gorjeta, troco, quantidade editável,
   pagamento em múltiplos meios/parcial.
3. **Sessão de caixa**: abrir/fechar turno, fundo de troco, sangria/suprimento, conferência cega.
4. **Estorno/reabertura** de comanda (reverte a baixa de estoque).
> Resultado: dá pra rodar uma loja/lanchonete de verdade no caixa, com fechamento de turno e cupom.

### Release 2 — "Serviços com hora marcada" (Onda C + D) · P1
Destrava **beleza, saúde, fitness** (a maior fatia dos 63 modelos):
5. **Agenda Pro**: profissional na agenda, duração por serviço, visão calendário (dia/semana),
   detecção de conflito, horário de funcionamento estruturado.
6. **Inbox produtivo**: respostas rápidas (maior gap de produtividade), SLA real, notas internas/
   anti-colisão.
> Resultado: barbearia/salão/clínica operam a agenda cheia sem dupla marcação.

### Release 3 — "IA que opera" (Onda E) · P2
7. **IA tool-calling**: abrir comanda pelo chat, consultar estoque ao vivo, enviar catálogo/mídia,
   escalar para humano por decisão própria, coletar campo estruturado.
10. **Automação de ciclo de vida**: pós-venda, pedido de avaliação/NPS, reengajamento de lead frio.
> Resultado: pedido de delivery/varejo fecha no WhatsApp; funil não esfria sozinho.

### Release 4 — "Auto-serviço e margem" (Ondas F + G) · P2/P3
8. **Auto-agendamento online** (link público). 9. **Comissão** por profissional.
12. **Catálogo/estoque++**: variações, código de barras, valorização, margem.

### Release 5 — "Formalização" (Onda H) · P3
11. **Verticais unificadas** (onboarding de ramo único). 13. **Fiscal NFC-e** via emissor terceiro.

---

## Detalhe por iniciativa (fases)

> Cada bloco vira um plano filho. Aqui fica o esqueleto: objetivo, fases, schema, arquivos-chave,
> dependências e nota de PROD. O plano da iniciativa 1 (impressão) já está escrito em detalhe.

### 1. Impressão de comanda/recibo — **plano completo em `2026-07-05-impressao-comanda.md`**
- **Fases:** N1 navegador (recibo HTML `@media print` 80/58mm + reimpressão) → N2 ESC/POS via
  QZ Tray (corte, gaveta, silencioso) → N3 comanda de cozinha por setor.
- **Schema (Onda A):** `Order.number` (sequencial p/ o cupom), `CatalogItem.printSector` (N3).
- **Arquivos-chave:** `src/components/vendas/OrderBoard.tsx`, `src/components/vendas/SalesHistoryPanel.tsx`,
  novo `src/components/vendas/ReceiptDocument.tsx`, novo `src/lib/receipt/escpos.ts` (N2).
- **Dependência:** nenhuma para N1. N3 fica melhor após POS financeiro (mostra desconto/total no cupom).

### 2. POS financeiro
- **Objetivo:** dar à comanda a camada entre itens e total: desconto (comanda e linha), acréscimo/
  taxa de serviço, gorjeta estruturada, troco (dinheiro), edição de quantidade, pagamento em
  múltiplos meios e parcial.
- **Fases:** (2.1) qtd editável no `OrderItem` + stepper na UI → (2.2) desconto/acréscimo/gorjeta no
  `Order` + recálculo do total derivado → (2.3) `OrderTender` (N linhas de pagamento) + valor
  recebido/troco → (2.4) refletir tudo no extrato e nos relatórios (por meio de pagamento passa a
  somar tenders).
- **Schema (Onda A):** `Order.discountCents/surchargeCents/tipCents/amountTenderedCents/changeCents`;
  model `OrderTender`.
- **Arquivos-chave:** `src/server/services/order.service.ts` (`orderTotalCents`, `closeOrder`),
  `src/app/api/vendas/orders/[id]/route.ts` (`closeSchema`), `OrderBoard.tsx` (painel de fechamento),
  `sales-report.service.ts` (revenueByPayment via tenders).
- **Dependência:** nenhuma. **Habilita** o cupom com desconto (iniciativa 1 N3) e a IA-cria-comanda (7).
- **PROD:** total continua **derivado** — desconto/acréscimo são ajustes sobre `Σ itens`, nunca
  desnormalize o total.

### 3. Sessão de caixa
- **Objetivo:** turno de caixa conferível: abrir com fundo de troco, registrar sangria/suprimento,
  fechar com conferência cega (contado vs esperado), relatório por turno.
- **Fases:** (3.1) models + serviço `cash-session.service` (abrir/fechar, movimentos) → (3.2) toda
  comanda fechada carimba `cashSessionId` da sessão aberta do operador → (3.3) UI: barra "Caixa
  aberto/fechado" no topo do `OrderBoard`, modais de sangria/suprimento e de fechamento → (3.4)
  relatório de conferência (esperado = fundo + vendas dinheiro + suprimentos − sangrias).
- **Schema (Onda B):** `CashSession`, `CashMovement`, `Order.cashSessionId`.
- **Dependência:** melhor **depois** do POS financeiro (o esperado usa tenders por dinheiro).
- **Risco:** definir política quando não há sessão aberta — permitir venda "sem sessão" (não travar
  dinheiro, alinhado ao princípio do estoque) e sinalizar.

### 4. Estorno / reabertura de comanda
- **Objetivo:** cancelar/estornar comanda fechada (erro de operador) revertendo a baixa de estoque
  e o lançamento de venda, com trilha de auditoria.
- **Fases:** (4.1) `OrderStatus += CANCELADA` + `reopenOrder`/`voidOrder` no serviço, revertendo
  `applyOrderStockExit` (movimento `AJUSTE`/`ENTRADA` de compensação) → (4.2) UI no extrato (ação
  "Estornar" com confirmação + motivo) → (4.3) relatórios excluem canceladas.
- **Schema (Onda B):** `ALTER TYPE OrderStatus ADD VALUE 'CANCELADA'`, `Order.canceledAt/canceledReason`.
- **Dependência:** convive com sessão de caixa (estorno dentro do turno afeta a conferência).
- **PROD:** `ADD VALUE IF NOT EXISTS` no enum — cuidado, `ALTER TYPE` não roda dentro de transação
  em algumas versões; aplicar isolado.

### 5. Agenda Pro (profissional + duração + calendário)
- **Objetivo:** operar agenda cheia de serviço: quem atende, quanto dura, visão de calendário, sem
  dupla marcação. **Maior destravador do lado serviços.**
- **Fases:** (5.1) model `Professional` + CRUD (em Configurações) + `Appointment.professionalId` →
  (5.2) `CatalogItem.durationMinutes` + agendamento passa a ter início+fim → (5.3) `WorkingHours`
  por profissional + validação de slot dentro do expediente → (5.4) **detecção de conflito** (mesmo
  profissional, janelas sobrepostas) → (5.5) **visão calendário** dia/semana por profissional
  (substitui/complementa a lista atual) → (5.6) criar agendamento **na própria tela da Agenda**
  (hoje só na ficha do cliente) e permitir walk-in sem lead.
- **Schema (Onda C):** `Professional`, `WorkingHours`, `Appointment.professionalId`,
  `CatalogItem.durationMinutes`; relaxar `Appointment.leadId` para opcional (walk-in).
- **Arquivos-chave:** `src/components/AgendaView.tsx` (lista→calendário), `appointment.service.ts`
  (conflito, duração), `AppointmentSection.tsx`, novo `professional.service.ts`.
- **Dependência:** pré-requisito de **auto-agendamento (8)** e **comissão (9)**.
- **Nota:** resolve também a ambiguidade do `needsReview` com múltiplos agendamentos
  ([[agenda-in-system-reminders]]) ao dar identidade de profissional/horário a cada slot.

### 6. Inbox produtividade (respostas rápidas + SLA + notas)
- **Objetivo:** atendente humano rende mais; nada de dois operadores respondendo o mesmo cliente.
- **Fases:** (6.1) model `QuickReply` + CRUD + inserção por `/` no `ConversationView` (com variáveis
  `{{nome}}`) → (6.2) SLA real: meta por conta, destaque de estouro na fila, coluna de tempo de
  primeira resposta (dados `queuedAt`/`firstResponseAt` já existem) → (6.3) `InternalNote` +
  indicador "fulano está vendo/digitando" (anti-colisão) via o SSE já existente (`useTenantStream`).
- **Schema (Onda D):** `QuickReply`, `InternalNote`. SLA sem coluna nova.
- **Arquivos-chave:** `src/components/ConversationView.tsx` (caixa de resposta), `inbox.service.ts`,
  `src/components/inbox/InboxView.tsx`.
- **Dependência:** nenhuma; alto ROI, baixo custo. **Comece por 6.1** (respostas rápidas).

### 7. IA tool-calling
- **Objetivo:** migrar o orquestrador determinístico (branches fixos em `respondToLead`) para um
  **loop de tools** que a IA aciona — destrava verticais sem branch novo.
- **Fases:** (7.1) registrar as capacidades atuais como tools (`agendar`, `qualificar`, `enviar_oferta`)
  sem mudar comportamento → (7.2) tool `enviar_catalogo`/`enviar_midia` (chama `sendWhatsAppMedia`) →
  (7.3) tool `consultar_estoque` (leitura ao vivo, sem cap de 40 itens) → (7.4) tool `criar_comanda`
  (usa `order.service` — depende do POS financeiro) → (7.5) tool `escalar_humano` (a IA decide mandar
  pra fila com motivo) → (7.6) opcional: RAG do knowledgeBase p/ contas com base grande.
- **Schema (Onda E):** nenhum obrigatório.
- **Arquivos-chave:** `src/server/services/conversation.service.ts` (`respondToLead`),
  `src/server/ai/provider.ts` (já tem `forcedToolCall` como base), `src/server/ai/prompts.ts`.
- **Dependência:** `criar_comanda` depende de (2). É a refatoração mais arriscada — fazer atrás de
  flag por número, com os testes de `agents.eval.test.ts` como rede.
- **Custo:** vigiar tokens/áudio ([[ai-context-and-media-policy]], [[pricing-plans-cost]]).

### 8. Auto-agendamento online (link público) — **plano completo em `2026-07-09-agendamento-online.md`**
- **Objetivo:** cliente marca sozinho por um link público, respeitando profissional/duração/expediente.
- **Fases (por dependência de dados, não pela numeração):** (1) Onda F — `User.publicSlug` + opt-in
  `bookingEnabled` + config de slot + Settings UI → (2) **motor de disponibilidade PURO** em
  `availability.ts` (hora-de-parede→UTC, varredura de dias no fuso, geração de slots livres; TDD) →
  (3) `booking-availability.service` (monta insumos do banco, reusa `conflictsFor`/`WorkingHours`) +
  endpoint público de slots + allowlist no `middleware.ts` + `rateLimit` → (4) página `/agendar/[slug]`
  (server component, herda branding via `getBranding`+`<BrandingStyle>`) + widget de seleção → (5)
  confirmação: POST público → **lead leve** (ou walk-in) + `createAppointment` (o mesmo do fluxo
  interno) + `pg_advisory_xact_lock` anti-corrida + mensagem de confirmação; lembrete pelo worker
  existente → (6) verificação E2E + rollout.
- **Schema (Onda F):** colunas em `User` (`publicSlug @unique`, `bookingEnabled`, config de slot);
  nenhum model novo. Compõe o `onda-f.sql` com a comissão (9).
- **Dependência:** **exige Agenda Pro (5)** inteira (lê `Professional`/`WorkingHours`/`durationMinutes`,
  reusa `createAppointment`/`conflictsFor`). Booking v1 é **por profissional** (conta sem `Professional`
  não usa o link no v1).
- **Riscos:** fuso (todo slot nasce de hora-de-parede local — função pura com round-trip nos testes);
  corrida de slot entre estranhos (trava por `professionalId+startISO` no confirm); enumeração de
  contas via slug (404 idêntico p/ inexistente×desligado + rate limit).

### 9. Comissão por profissional
- **Objetivo:** calcular comissão por profissional sobre serviço/venda.
- **Fases:** (9.1) `CommissionRule` (percentual/fixo por serviço ou global do profissional) → (9.2)
  snapshot `OrderItem.commissionCents` no fechamento (via profissional do agendamento ligado) →
  (9.3) relatório de comissão por profissional/período.
- **Schema (Onda F):** `CommissionRule`, `OrderItem.commissionCents`.
- **Dependência:** **exige Professional (5)**.

### 10. Automação de ciclo de vida
- **Objetivo:** o funil não esfria sozinho; pós-venda e reputação viram automáticos.
- **Fases:** (10.1) pós-venda: mensagem N horas após `PAGO`/`REALIZADO` (worker) → (10.2) pedido de
  avaliação/NPS após atendimento concluído → (10.3) reengajamento de lead frio (sem resposta há N
  dias → mensagem de win-back), com opt-out respeitado.
- **Schema (Onda E):** eventual `Lead.lastEngagedAt`; resto usa timestamps existentes.
- **Arquivos-chave:** `src/server/worker/run.ts` (novo tick), `meeting-reminders.ts` como padrão de
  janela idempotente, `messaging.ts`.
- **Dependência:** nenhuma dura; casa bem com tool-calling (7) mas roda no worker sem ele.
- **Cuidado legal:** reengajamento é cold-ish outbound — respeitar opt-out/consent ([[product-readiness-baseline]]).

### 11. Verticais unificadas
- **Objetivo:** de uma escolha de ramo, configurar persona + catálogo + campos + tema + rótulos do
  funil de forma coerente (hoje são 3–4 ações opt-in soltas).
- **Fases:** (11.1) `customFieldsPreset` para as verticais de alto valor (petshop, oficina, ótica,
  imobiliária, restaurante, clínica) — hoje só `revenda-veiculos` tem → (11.2) popular
  `suggestedOffers` (declarado e nunca usado) → (11.3) temas para as 4 categorias faltantes (casa,
  educação, varejo, eventos) → (11.4) **wizard de onboarding** que aplica tudo de uma vez → (11.5)
  catálogo semeado estruturado (hoje é heurístico, raspando texto do knowledgeBase, com preço zero).
- **Schema:** nenhum (é conteúdo em `src/lib/business-templates.ts` + `src/lib/theme/presets.ts`).
- **Dependência:** independe; melhor **depois** de POS/Agenda (os presets referenciam campos reais).

### 12. Catálogo/estoque++ — **plano completo em `2026-07-11-catalogo-estoque-avancado.md`**
- **Fases:** (12.1) valorização de estoque (Σ qtd×custo) + **margem** — potencial no catálogo (preço−custo, %,
  reusa `costCents`, **sem schema**) e **realizada** por período (snapshot `OrderItem.unitCostCents` no
  fechamento) → (12.2) código de barras/EAN (`CatalogItem.barcode` único por conta) + **bipar** no caixa
  (lookup → adiciona à comanda) → (12.3) variações/grade via **SKU flat** (`CatalogItem.variantGroup` agrupa;
  cada variação continua uma `CatalogItem` com estoque/preço/barcode próprios).
- **Schema (Onda G):** `CatalogItem.barcode` (+`@@unique([accountId, barcode])`), `CatalogItem.variantGroup`,
  `OrderItem.unitCostCents`. **`ItemVariant` relacional ADIADO** (decisão travada no plano filho). Um único
  `prisma/manual/2026-07-11-onda-g.sql` composto.
- **Arquivos-chave:** novo `src/lib/margin.ts` (puro), novo `stock-valuation.service.ts`, `sales-report.service.ts`
  (`salesMargin`), `order.service.ts` (snapshot no `closeOrder`), `catalog.service.ts` (barcode/variantGroup +
  `findByBarcode`), `CatalogManager.tsx`/`OrderBoard.tsx`/`StockPanel.tsx`/`ReportsPanel.tsx`.
- **Dependência:** independe; alto valor pra varejo. **Custo ausente** conta como 0 mas é **exibido** como
  parcial (nunca margem/valor otimista silencioso).

### 13. Fiscal NFC-e (emissor terceiro) — **plano completo em `2026-07-12-fiscal-nfce.md`**
- **Objetivo:** emissão de **NFC-e (modelo 65)** **opt-in por conta**, sem construir SEFAZ do zero.
- **Fases:** (13.1) abstração de emissor (`FiscalEmitter`/`fiscalEmitterFor`, adaptador Focus NFe + mock) +
  credencial **BYOK cifrada** + perfil fiscal mínimo + config nas Configurações → (13.2) **carimbo**
  `fiscalStatus=PENDENTE` no fechamento (só conta opt-in) + **tick assíncrono no worker**
  (`dispatchPendingFiscalEmissions`, flip atômico, kill-switch `FISCAL_EMISSION`) → (13.3) status fiscal +
  **DANFE** (reimpressão) no extrato + retry manual de `ERRO` + cancelamento best-effort no estorno (opcional).
- **Schema (Onda H):** enums `FiscalProvider`/`FiscalEnv`/`FiscalStatus`; em `User` credencial BYOK cifrada +
  perfil fiscal; em `Order` `fiscalStatus`/`fiscalDocId`/`fiscalKey`/`fiscalDanfeUrl`/`fiscalError`/timestamps/
  `fiscalAttempts`. Detalhe e *desvios conscientes* no plano filho e na nota ⁵. `CatalogItem.ncm/cfop` por item
  **ADIADO**.
- **Arquivos-chave:** novo `src/server/fiscal/` (`emitter.ts`/`focus-nfe.ts`/`mock.ts`), novo
  `fiscal-credential.service.ts`, novo `fiscal-emission.ts` (puro + serviço do worker), `order.service.ts`
  (carimbo no `closeOrder`), `worker/run.ts` (tick), `api/account/fiscal-key/route.ts`, `AccountSettings.tsx`,
  `SalesHistoryPanel.tsx` (badge + DANFE), `crypto.ts` (reuso).
- **Dependência:** POS financeiro (2) fechado; **último** por complexidade e por ser opcional. Sobe **inerte**
  (2 chaves: `FISCAL_EMISSION` global + `fiscalEnabled` por conta). Precisa de `ENCRYPTION_KEY` no worker.

---

## Sequência recomendada (caminho crítico)

```
Onda A ─┬─ (1) Impressão N1 ───────────────► cupom/recibo p/ todo balcão
        └─ (2) POS financeiro ──┐
Onda B ─┬─ (3) Sessão de caixa ◄┘ (usa tenders)
        └─ (4) Estorno de comanda
Onda C ─── (5) Agenda Pro ──────┬─────────► (8) Agendamento online
                                └─────────► (9) Comissão
Onda D ─── (6) Inbox produtivo (independe — pode ir em paralelo desde já)
Onda E ─┬─ (7) IA tool-calling (precisa de 2 p/ criar_comanda)
        └─ (10) Automação de ciclo de vida
Onda G ─── (12) Catálogo/estoque++ (independe)
Onda D ─── (11) Verticais unificadas (depois de 2 e 5)
Onda H ─── (13) Fiscal (por último, opt-in)
```

**Comece já, em paralelo, por três frentes independentes de alto ROI:**
**(1) Impressão N1**, **(2) POS financeiro** e **(6.1) Respostas rápidas** — nenhuma depende de
outra e as três aparecem para o cliente na primeira semana.

---

## Riscos transversais

- **Migrations em PROD** — a maior fonte de dor histórica. Respeitar as ondas e o SQL idempotente;
  `ALTER TYPE` (enum) fora de transação; nunca duplicar manual×migration ([[prod-schema-drift-destravar]]).
- **Deploy** — Vercel Hobby bloqueia push; deploy via CLI com token do time ([[vercel-hobby-push-block]]).
  Worker no Oracle atualiza por `git pull` + restart ([[worker-oracle-update-procedure]]).
- **Custo de token** na IA tool-calling e automação — vigiar, sobretudo Whisper/áudio ([[pricing-plans-cost]]).
- **Refatoração do orquestrador (7)** é a mais arriscada — atrás de flag, com `agents.eval.test.ts`
  como rede de segurança.
- **Impressão N2/N3** depende de app local (QZ Tray) no PC do cliente — suporte/instalação vira
  custo de onboarding; N1 (navegador) não tem esse ônus e cobre a maioria.
