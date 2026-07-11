# Catálogo de funcionalidades da plataforma

> Documento de referência para **verificação interna** e **base de comunicação com o cliente**.
> Cada bloco traz o benefício (linguagem de cliente) e, onde útil, a nota técnica de onde vive.
> Status de deploy em PROD é rastreado no `docs/plans/2026-07-05-roadmap-multinegocio.md`.

**O que é:** um CRM + central de atendimento por IA no WhatsApp + sistema de operação do balcão
(caixa, agenda, estoque, financeiro) para negócios locais. A IA atende 24/7 e a plataforma opera a
loja de ponta a ponta — do primeiro "oi" no WhatsApp ao cupom impresso e à nota fiscal.

---

## 1. Atendimento inteligente no WhatsApp

O coração do produto: uma IA que atende como um funcionário treinado do negócio.

- **Multi-número / multi-empresa:** vários chips de WhatsApp numa mesma conta; cada número é uma
  "empresa" com atendimento próprio.
- **63 modelos de negócio prontos:** ao escolher o ramo (barbearia, oficina, clínica, restaurante,
  petshop, imobiliária…), a IA já vem com persona, tom de voz e roteiro de conhecimento do setor.
- **Responde 24/7:** tira dúvidas com base no conhecimento da empresa (produtos, preços, horários,
  endereço), qualifica o lead e classifica interesse automaticamente.
- **A IA age, não só responde** (tool-calling):
  - **Abre comanda pelo chat** — cliente pede "quero 2 X-burger" e vira pedido registrado.
  - **Consulta o estoque ao vivo** — responde disponibilidade real e marca item esgotado.
  - **Envia catálogo, fotos e PDF** — cardápio, tabela de preços, foto do produto.
  - **Agenda serviço/consulta** e **apresenta oferta com cobrança Pix** automática.
  - **Escala para um humano** sozinha quando trava ou o caso é sensível.
- **Entende áudio:** transcreve mensagens de voz e responde normalmente.
- **Handoff suave:** quando um atendente humano assume, a IA se cala; volta sozinha quando resolvido.
- **Configurável por número:** persona, base de conhecimento, horário, instruções, modelo de IA.
- *Nota técnica:* o caminho agêntico é **ligado por flag** (opt-in por número). `src/server/ai/tools/`,
  `runToolLoop`, `MediaAsset`.

## 2. Inbox / Multiatendimento (equipe humana)

Quando o humano entra, a central é feita para atender rápido e sem atropelo.

- **Fila e estados de atendimento:** IA → Fila → Atendendo → Aguardando → Resolvida.
- **SLA de resposta:** meta configurável, destaque visual quando estoura e tempo de 1ª resposta.
- **Respostas rápidas:** atalhos com `/` e variáveis (`{{nome}}`) — o atendente não digita do zero.
- **Notas internas:** recados da equipe na conversa que o cliente nunca vê.
- **Anti-colisão:** mostra quem já está atendendo aquele cliente (evita dois responderem juntos).
- **Mídia e contexto:** recebe/envia imagem, documento e áudio; citar/responder mensagem.
- **Sugestão de resposta por IA:** um clique gera um rascunho para o atendente revisar e enviar.
- *Nota técnica:* models `QuickReply`, `InternalNote`; SLA reusa `queuedAt`/`firstResponseAt`;
  presença via SSE/Redis.

## 3. Caixa / PDV (comanda)

Registra vendas do balcão de ponta a ponta.

- **Abrir comanda** avulsa, por telefone (vira cliente no CRM) ou para walk-in.
- **Catálogo de produtos e serviços** com preço; itens do ramo semeados automaticamente.
- **Camada financeira completa:** quantidade editável, **desconto** (na comanda e no item),
  **taxa de serviço/acréscimo**, **gorjeta**.
- **Pagamento flexível:** vários meios na mesma comanda (dinheiro + Pix + cartão), **cálculo de troco**
  e fechamento **parcial**.
- **Impressão de cupom em 3 níveis:**
  - **Navegador (80/58mm):** funciona em qualquer impressora — Bematech, Elgin, Epson ou até laser A4.
  - **ESC/POS (via QZ Tray):** corte automático de papel e **abertura de gaveta de dinheiro**.
  - **Comanda de cozinha:** roteia itens por setor (cozinha/bar) para a produção.
  - **Reimpressão** de qualquer comanda pelo extrato.
- **Sessão de caixa (turno conferível):** abrir com fundo de troco, **sangria/suprimento**, e
  **fechamento cego** com conferência (contado × esperado).
- **Estorno/reabertura:** cancela comanda fechada devolvendo o estoque, com motivo e auditoria.
- **Número sequencial de cupom** e **campos por ramo** na comanda (ex.: placa/chassi na revenda).
- *Nota técnica:* `Order`/`OrderItem`/`OrderTender`, `CashSession`/`CashMovement`, ondas A e B (PROD).

## 4. Estoque

Controle simples e opt-in, sem atrapalhar quem só vende serviço.

- **Liga por produto** (`trackStock`) — barbearia controla a pomada, não o corte.
- **Baixa automática** quando a comanda fecha; **livro-razão imutável** de toda movimentação.
- **Entradas e ajustes** manuais (compra, inventário, perda).
- **Alerta de estoque mínimo.**
- **Código de barras/EAN:** bipar resolve o item no caixa.
- **Auto-sugerir nome no cadastro:** ao bipar/digitar um código de barras ao cadastrar um produto,
  o sistema consulta uma base externa (Open Food Facts grátis; Cosmos com token) e **pré-preenche o
  nome** (editável) — o **preço é sempre do lojista**. Cache global + fail-open: sem base/erro, o
  cadastro segue manual, igual antes.
- **Custo → margem e valorização** do estoque.
- **A IA respeita o estoque:** marca "indisponível" no atendimento quando esgota.
- *Nota técnica:* `CatalogItem.trackStock/stockQty/barcode`, `StockMovement`, ondas A e G.

## 5. Agenda

Operação de serviço com hora marcada, para agenda cheia sem bagunça.

- **Profissional/recurso:** cada agendamento sabe quem atende (barbeiro, médico, manicure).
- **Duração por serviço:** cada serviço tem seu tempo; o horário ganha início e fim reais.
- **Visão calendário** (dia/semana por profissional) além da lista.
- **Detecção de conflito:** bloqueia dupla marcação do mesmo profissional (com opção de encaixe).
- **Horário de funcionamento estruturado** (expediente e intervalo) por profissional.
- **Lembretes automáticos por WhatsApp** (véspera e 1h antes), com texto configurável.
- **Confirmação automática:** o cliente responde ao lembrete e a IA move o agendamento
  (confirmado/cancelado/remarcar), sinalizando para a equipe conferir.
- **Auto-agendamento online:** link público onde o próprio cliente marca, respeitando profissional,
  duração e expediente.
- **Walk-in** sem cadastro e **pacotes/séries** de sessões.
- **Comissão por profissional:** regra em % ou valor fixo, com snapshot no fechamento e relatório.
- *Nota técnica:* `Professional`, `WorkingHours`, `Appointment.professionalId/durationMinutes`,
  `CommissionRule`, rota `/agendar`, ondas C e F.

## 6. CRM / Leads

A base de relacionamento por trás de tudo.

- **Funil de vendas** com etapas renomeáveis por conta.
- **Pessoa física ou jurídica** com CPF/CNPJ.
- **Campos personalizados por ramo** no lead, na comanda e no item.
- **Etiquetas (tags)** coloridas.
- **Qualificação e score automáticos** pela IA (interesse, urgência, orçamento…).
- **Ficha do cliente** com histórico, agendamentos e comandas.
- **Campanhas em massa** com aquecimento (cap diário por chip) e opt-out.
- *Nota técnica:* `Lead`, `CustomFieldDef` (scope LEAD/ORDER/ORDER_ITEM), `Campaign`, `Qualification`.

## 7. Automação de ciclo de vida

O relacionamento continua sozinho, nos momentos certos.

- **Pós-venda:** mensagem automática após a compra/atendimento ("curtiu? qualquer ajuste é conosco").
- **Avaliação/NPS:** pede nota depois do serviço; nota baixa vira alerta para recuperar o cliente.
- **Reengajamento de lead frio:** quem sumiu há X dias recebe um "win-back".
- **Opt-in e seguro:** desligado por padrão, respeita opt-out e janelas de horário.
- *Nota técnica:* `lifecycleAutomationEnabled`, `Lead.lastEngagedAt`, worker `dispatchLifecycleAutomations`.

## 8. Financeiro & Gestão da conta

- **Despesas e contas a pagar** com categorias, vencimento e **recorrência** mensal.
- **Saldo do negócio:** faturamento − despesas pagas (regime de caixa).
- **Relatórios do caixa:** faturamento, ticket médio, por meio de pagamento, por operador, top itens,
  e **conferência por sessão/turno**.
- **Equipe e permissões:** operadores com controle fino (campanhas, configurações, escopo de leads).
- **Branding multivertical:** tema/cor, logo e nome do app por conta (marca branca).
- **BYOK:** o cliente pode usar a própria chave de IA e o próprio gateway de pagamento.
- **Billing/planos** (administração da plataforma): prazo de acesso, suspensão de inadimplente,
  cota de IA por plano.
- *Nota técnica:* `Expense`/`RecurringExpense`, `Payment`, `AccountBranding`, entitlements/planos.

## 9. Fiscal — NFC-e (opcional)

Emissão fiscal sem construir integração com a SEFAZ do zero.

- **Emissão via emissor terceiro** (Focus NFe / PlugNotas / Tecnospeed) com credencial **cifrada (BYOK)**.
- **Ambiente de homologação e produção**, série, CNPJ e NCM/CFOP padrão configuráveis.
- **Status fiscal por comanda**, DANFE, e reprocessamento automático de pendências pelo worker.
- **Opt-in por conta** e **kill-switch** global.
- *Nota técnica:* `User.fiscal*`, `Order.fiscal*`, worker `dispatchPendingFiscalEmissions`, onda H.

---

## Diferenciais para destacar na venda

1. **IA que opera a loja, não só um chatbot** — abre pedido, cobra Pix, agenda e consulta estoque
   dentro do WhatsApp.
2. **Multi-número real** — várias empresas/filiais numa conta só.
3. **63 ramos prontos** — o cliente escolhe o segmento e já sai configurado.
4. **Do WhatsApp ao cupom (e à nota)** — atendimento, caixa, impressão térmica e NFC-e no mesmo lugar.
5. **Agenda profissional de verdade** — profissional, duração, conflito e auto-agendamento online.
6. **Marca branca** — a plataforma leva a identidade do cliente.

---

## Mapa de verificação (iniciativa → onda → estado)

| # | Módulo | Onda | Estado no repo |
|---|---|---|---|
| 1 | Impressão de comanda (N1/N2/N3) | A | Feito · **PROD ✅** |
| 2 | POS financeiro | A | Feito · **PROD ✅** |
| 3 | Sessão de caixa | B | Feito · **PROD ✅** |
| 4 | Estorno/reabertura | B | Feito · **PROD ✅** |
| 5 | Agenda Pro | C | Feito (dev) · PROD a confirmar |
| 6 | Inbox produtivo | D | Feito (dev) · PROD a confirmar |
| 7 | IA tool-calling | E | Feito (dev, gated por flag) · PROD a confirmar |
| 8 | Auto-agendamento online | F | Feito (dev) · PROD a confirmar |
| 9 | Comissão | F | Feito (dev) · PROD a confirmar |
| 10 | Automação de ciclo de vida | E | Feito (dev, opt-in) · PROD a confirmar |
| 11 | Verticais unificadas | D | Feito (dev) · PROD a confirmar |
| 12 | Catálogo/estoque++ | G | Feito (dev) · PROD a confirmar |
| 13 | Fiscal NFC-e | H | Feito (dev, opt-in) · PROD a confirmar |

> **Atenção antes de anunciar ao cliente:** ondas C–H estão implementadas em dev, mas o deploy em
> PROD (aplicar `onda-c…h.sql` no Supabase + `vercel deploy`) precisa ser **confirmado**. Só comunique
> como disponível o que estiver em produção. Alguns recursos são **opt-in/gated** (IA agêntica,
> automação de ciclo de vida, fiscal) — não vêm ligados por padrão.
