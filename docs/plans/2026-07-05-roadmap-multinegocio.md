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
| 5 | Agenda Pro (profissional/recurso + duração por serviço + visão calendário + conflito) | C | **P1** | `2026-07-07-agenda-profissional.md` — **FEITO (dev)** ¹ |
| 6 | Respostas rápidas + SLA + notas internas/anti-colisão (inbox) | D | **P1** | `2026-07-07-inbox-produtividade.md` — **FEITO (dev)** ¹ |
| 7 | IA tool-calling (criar comanda, consultar estoque, enviar catálogo/mídia, escalar) | E | **P2** | `2026-07-08-ia-tool-calling.md` — **FEITO (dev)** ¹ (gated por flag) |
| 8 | Auto-agendamento online (link público) | F | **P2** | `2026-07-09-agendamento-online.md` — **plano escrito, pronto p/ executar** (depende de 5, já em dev) |
| 9 | Comissão por profissional | F | **P2** | `2026-07-09-comissao.md` — **FEITO (dev)** ¹ (motor puro + CRUD + snapshot no fechamento + relatório + UI; `onda-f.sql` composto, PROD a aplicar) |
| 10 | Automação de ciclo de vida (pós-venda, NPS/avaliação, reengajamento de frio) | E | **P2** | `2026-07-08-automacao-ciclo-vida.md` |
| 11 | Verticais unificadas (onboarding único, presets de campo/oferta, temas faltantes) | D | **P3** | `2026-07-10-verticais-unificadas.md` |
| 12 | Catálogo/estoque++ (variações, código de barras/EAN, valorização, margem) | G | **P3** | `2026-07-11-catalogo-estoque-avancado.md` |
| 13 | Fiscal NFC-e via emissor terceiro (opt-in por conta) | H | **P3** | `2026-07-12-fiscal-nfce.md` |

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
- **Onda D** (iniciativas 6, 11): novo model **`QuickReply`** (snippet por conta, `title`, `body`,
  `shortcut`). Novo model **`InternalNote`** (nota de operador na conversa/lead). *SLA reusa
  `queuedAt`/`firstResponseAt` já existentes — sem coluna nova.*
- **Onda E** (iniciativas 7, 10): sem schema novo obrigatório (tool-calling refatora serviço;
  automação usa worker + timestamps já existentes). Eventual `Lead.lastEngagedAt` p/ reengajamento.
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
- **Onda G** (iniciativa 12): `CatalogItem.barcode String?`; model **`ItemVariant`** (grade/tamanho)
  ou manter SKU flat (decisão no plano filho).
- **Onda H** (iniciativa 13): `Order.fiscalStatus`, `Order.fiscalDocId`, credenciais do emissor
  cifradas em `User` (padrão BYOK — [[strong-model-byok-only]]).

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

### 12. Catálogo/estoque++
- **Fases:** (12.1) valorização de estoque (Σ qtd×custo) e relatório de margem (dados `costCents`/
  `unitCostCents` já existem, nunca exibidos) → (12.2) código de barras/EAN + busca por código no
  caixa → (12.3) variações/grade (tamanho/cor) — decidir model `ItemVariant` vs SKU flat.
- **Schema (Onda G):** `CatalogItem.barcode`; opcional `ItemVariant`.
- **Dependência:** independe; alto valor pra varejo.

### 13. Fiscal NFC-e (emissor terceiro)
- **Objetivo:** emissão fiscal **opt-in por conta**, sem construir SEFAZ do zero.
- **Fases:** (13.1) integração com um emissor por API (Focus NFe / PlugNotas / Tecnospeed) atrás de
  credencial BYOK cifrada → (13.2) emitir no fechamento da comanda (assíncrono, worker) → (13.3)
  status fiscal + reimpressão do DANFE no extrato.
- **Schema (Onda H):** `Order.fiscalStatus/fiscalDocId`, credenciais cifradas em `User`.
- **Dependência:** POS financeiro (2) fechado; **último** por complexidade e por ser opcional.

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
