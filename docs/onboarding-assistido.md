# Onboarding Assistido — Roteiro & Checklist

> Plano **Escala (R$497/mês)**. Objetivo: colocar o cliente pra rodar de verdade na primeira semana, com a conexão dos números feita junto (ponto mais frágil no Baileys multi-número).
>
> **Meta de sucesso:** cliente com número conectado, base importada e pelo menos 1 fluxo (IA + agenda) funcionando ponta a ponta, usando sozinho até o fim da semana 1.

---

## Fase 0 — Antes da call (assíncrono)

- [ ] Enviar e-mail/WhatsApp de boas-vindas com link de agendamento da call de setup
- [ ] Pedir antecipado:
  - [ ] Quantos números de WhatsApp vai conectar (Escala = até 4)
  - [ ] Quantos usuários/seats vai criar (Escala = até 10)
  - [ ] Base de contatos pronta (CSV/planilha) com nome + telefone
- [ ] Confirmar que os celulares/chips dos números estarão à mão na hora da call (precisa escanear QR)
- [ ] Criar a conta do cliente já no estado correto (não suspensa) e validar billing

---

## Fase 1 — Call de Setup (30–60 min)

### 1.1 Conta e usuários
- [ ] Login do dono funcionando
- [ ] Criar os usuários/seats da equipe
- [ ] Definir permissões/papéis de cada um
- [ ] Mostrar onde fica o `/financeiro` e o que significa conta suspensa

### 1.2 Conexão dos números (ponto crítico — fazer JUNTO)
- [ ] Conectar número 1 via pareamento (QR / Baileys)
- [ ] **Teste real:** enviar 1 msg e receber 1 msg nesse número
- [ ] Repetir para os demais números (até 4)
- [ ] Orientar boas práticas pra evitar ban:
  - [ ] Usar chip aquecido, não número novo zerado
  - [ ] Não disparar volume alto no dia 1
  - [ ] Não deixar o celular do número desligado/sem internet por muito tempo
- [ ] Explicar o que fazer se cair a conexão (re-parear)

### 1.3 Base de contatos
- [ ] Importar o CSV/planilha de leads
- [ ] Conferir se nomes e telefones vieram certos (formato/DDD)
- [ ] Validar 1 ou 2 contatos manualmente

### 1.4 Mensagens e campanhas
- [ ] Criar 1º template de mensagem
- [ ] Montar a 1ª campanha/disparo de teste (grupo pequeno)
- [ ] Disparar o teste e confirmar entrega

### 1.5 IA de qualificação
- [ ] Configurar contexto da IA (o que a empresa vende, tom de voz)
- [ ] Definir regras de qualificação (o que é lead bom/ruim)
- [ ] Lembrar a limitação: a IA lê só texto (mídia → responde "só leio texto")
- [ ] Simular 1 conversa de teste pra validar a resposta

### 1.6 Agenda e lembretes
- [ ] Mostrar a rota `/agenda`
- [ ] Criar 1 agendamento de teste
- [ ] Confirmar que o lembrete via WhatsApp dispara (véspera / 1h antes)

### 1.7 Fechamento da call
- [ ] Deixar **pelo menos 1 fluxo completo rodando** (lead → IA → agenda → lembrete)
- [ ] Combinar o canal de suporte direto (WhatsApp/Slack)
- [ ] Agendar o check-in da semana 1

---

## Fase 2 — Acompanhamento (Semana 1)

- [ ] Canal de suporte direto aberto pra dúvida rápida
- [ ] Check-in após ~3 dias:
  - [ ] Os números seguem conectados? (sem ban/queda)
  - [ ] Está disparando de verdade?
  - [ ] A IA está respondendo bem?
  - [ ] Algum agendamento real aconteceu?
- [ ] Resolver travas e reconfigurar o que estiver torto

---

## Fase 3 — Marco de ativação (fim da Semana 1)

Cliente considerado **ativado** quando:

- [ ] Todos os números contratados conectados e estáveis
- [ ] Base importada e em uso
- [ ] Pelo menos 1 campanha real enviada (além do teste)
- [ ] IA respondendo leads sozinha
- [ ] Pelo menos 1 agendamento real com lembrete disparado
- [ ] Cliente sabe operar sem precisar da sua equipe pra cada passo

> Se não bateu a ativação, marcar nova call — não deixar o cliente esfriar.

---

## Diferença entre planos (referência interna)

| | Inicial (127) | Pro (247) | **Escala (497)** |
|---|---|---|---|
| Onboarding | Self-service (vídeos/docs) | Self-service + suporte | **Call de setup + config feita junto + acompanhamento semana 1** |

---

## Por que o "assistido" se paga

No modelo **Baileys multi-número**, conectar número errado → ban → cliente culpa o produto e cancela.
Fazer a conexão **na call, junto com o cliente**, é onde o onboarding assistido mais devolve valor:
evita o ban inicial, garante o "aha moment" (primeira mensagem entrando/saindo) e reduce churn no mês 1.
