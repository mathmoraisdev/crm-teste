import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Logo } from "@/components/app/Logo";
import { ConsultantModal } from "@/components/ConsultantModal";
import { PricingPlans } from "@/components/marketing/PricingPlans";

// Selos honestos (sem métricas inventadas): destacam termos comerciais reais.
const PERKS = [
  { label: "Sem fidelidade" },
  { label: "Cancele quando quiser" },
  { label: "Conecte em 30s" },
  { label: "Suporte de gente de verdade" },
];

const STEPS = [
  {
    n: "01",
    title: "Conecte seu WhatsApp",
    desc: "Escaneie o QR Code com o celular e pronto. Funciona com o número que você já usa, sem migrar nada.",
  },
  {
    n: "02",
    title: "Escolha o seu ramo",
    desc: "A IA já vem treinada com a persona do seu tipo de negócio e o painel se veste com a cara da sua marca.",
  },
  {
    n: "03",
    title: "Atenda e gerencie",
    desc: "A IA responde e qualifica cada cliente; você acompanha no CRM, marca na agenda, fecha no caixa e controla o estoque — em tempo real.",
    dark: true,
  },
];

const FEATURES = [
  {
    title: "Atendimento com IA",
    desc: "A IA responde cada cliente no WhatsApp, faz as perguntas certas, dá um score de 0 a 100 e propõe o horário — 24h por dia, no tom do seu negócio.",
  },
  {
    title: "Vários números, um painel só",
    desc: "Conecte até 4 números de WhatsApp e atenda todos numa caixa única — cada um com sua própria IA, persona e campanhas. A maioria das ferramentas trava você em 1 número.",
  },
  {
    title: "CRM integrado",
    desc: "Cada conversa vira um lead com status, score e histórico. Kanban simples, do jeito que o WhatsApp pede.",
  },
  {
    title: "Agenda e lembretes",
    desc: "Marque compromissos e a IA propõe horários. O cliente recebe lembrete no WhatsApp na véspera e na hora — menos falta, mais presença.",
  },
  {
    title: "Caixa e financeiro",
    desc: "Registre vendas e despesas do dia, contas a pagar e acompanhe o saldo do negócio — sem planilha, direto no painel.",
  },
  {
    title: "Controle de estoque",
    desc: "Ative por produto: entradas, ajustes e baixa automática a cada venda fechada. Saiba o que tem, o que saiu e o que falta.",
  },
  {
    title: "Disparos e campanhas",
    desc: "Envie mensagens personalizadas em massa com cadência humana e fila automática — reativação, promoções e avisos, sem esforço.",
  },
  {
    title: "Relatórios em tempo real",
    desc: "Entregas, respostas, conversões e saldo. Saiba exatamente o que está dando retorno.",
  },
  {
    title: "IA inclusa, sem custo escondido",
    desc: "Todo plano já vem com IA que atende e qualifica. Quer os modelos mais avançados (GPT-4o, Claude) sem limite de uso? Conecte sua própria chave e a IA fica ilimitada — você paga direto no provedor.",
  },
];

const PLANS = [
  {
    name: "Inicial",
    desc: "Para atender e gerenciar o negócio no WhatsApp.",
    priceMonthly: 97,
    cta: "Começar grátis",
    selfServe: true,
    features: [
      "1 número de WhatsApp",
      "2 usuários",
      "4.000 mensagens de IA/mês (≈ 1.000 conversas)",
      "1.000 contatos",
      "Atendimento com IA",
      "CRM + Kanban + Agenda",
      "Caixa completo: PDV, estoque e despesas",
    ],
  },
  {
    name: "Profissional",
    desc: "Para automatizar o atendimento e escalar.",
    priceMonthly: 247,
    cta: "Começar grátis",
    selfServe: true,
    featured: true,
    features: [
      "2 números de WhatsApp",
      "5 usuários",
      "10.000 mensagens de IA/mês (≈ 2.500 conversas)",
      "5.000 contatos",
      "Tudo do Inicial, mais:",
      "Qualificação por IA + agendamento automático",
      "Campanhas e disparos",
      "Cobrança por Pix",
    ],
  },
  {
    name: "Escala",
    desc: "Para agências e times de vendas.",
    priceMonthly: 497,
    cta: "Falar com um consultor",
    features: [
      "4 números de WhatsApp",
      "10 usuários",
      "24.000 mensagens de IA/mês (≈ 6.000 conversas)",
      "25.000 contatos",
      "Tudo do Profissional, mais:",
      "Suporte prioritário",
      "Onboarding assistido",
    ],
  },
];

const FAQ = [
  {
    q: "Vou tomar bloqueio no meu WhatsApp?",
    a: "Nenhuma ferramenta de disparo elimina o risco — ele existe. O que fazemos é reduzi-lo ao máximo: aquecimento de número, cadência humana e limites por hora que você controla. Quanto mais natural for o ritmo de envio, menor o risco.",
  },
  {
    q: "Preciso instalar algum programa?",
    a: "Não. Tudo roda no navegador. Você só escaneia o QR Code uma vez com o celular para conectar seu WhatsApp.",
  },
  {
    q: "Funciona com meu número atual?",
    a: "Sim. Você conecta o número que já usa, sem precisar migrar ou comprar chip novo. Continua recebendo suas conversas normalmente.",
  },
  {
    q: "Como funciona o teste grátis?",
    a: "Você testa sem cartão de crédito: atendimento com IA, CRM, agenda, caixa e campanhas. Se não quiser continuar, é só não assinar — nada é cobrado.",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Sempre. Não há fidelidade nem multa. Cancela com um clique direto no painel e mantém o acesso até o fim do período pago.",
  },
];

export function Landing() {
  return (
    <div data-theme="light" className="min-h-screen bg-slate-50 text-ink">
      {/* NAV */}
      <header className="sticky top-0 z-50 border-b border-[rgba(10,27,20,.06)] bg-slate-50/80 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-4 md:px-8">
          <Logo size="lg" />
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#funciona" className="text-sm font-semibold text-slate-600 hover:text-ink">Como funciona</a>
            <a href="#recursos" className="text-sm font-semibold text-slate-600 hover:text-ink">Recursos</a>
            <a href="#precos" className="text-sm font-semibold text-slate-600 hover:text-ink">Planos</a>
            <a href="#faq" className="text-sm font-semibold text-slate-600 hover:text-ink">Perguntas</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="px-2 py-2 text-sm font-bold text-ink">Entrar</Link>
            <ConsultantModal
              trigger={
                <button
                  type="button"
                  className="hidden rounded-xl border border-[#E0E7E3] bg-white px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:border-brand-400 hover:text-brand-700 sm:inline-flex"
                >
                  Falar com um consultor
                </button>
              }
            />
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-500"
            >
              Criar conta grátis
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-32 -top-44 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,.16),transparent_65%)]" />
        <div className="pointer-events-none absolute -left-40 top-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,.10),transparent_65%)]" />
        <div className="relative mx-auto max-w-[1180px] px-6 pb-9 pt-16 md:px-8 md:pt-20">
          <div className="mx-auto flex max-w-[840px] flex-col items-center text-center">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-[#E2EAE6] bg-white py-1.5 pl-2 pr-3.5 shadow-[0_2px_10px_-4px_rgba(10,27,20,.1)]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-mono text-[11px] tracking-[0.04em] text-brand-700">
                <span className="h-1.5 w-1.5 animate-pulsedot rounded-full bg-brand-400" />
                NOVO
              </span>
              <span className="text-[13px] font-semibold text-slate-600">
                Conecte o WhatsApp e comece em 30 segundos
              </span>
            </div>

            <h1 className="mt-6 font-display text-[42px] font-bold leading-[1.02] tracking-[-0.035em] text-ink sm:text-[54px] md:text-[62px]">
              Atenda no WhatsApp.
              <br className="hidden sm:block" /> Gerencie o <span className="text-brand-500">negócio inteiro</span> num lugar só
            </h1>
            <p className="mt-5 max-w-[600px] text-[17px] leading-relaxed text-slate-600 md:text-[19px]">
              A IA responde e qualifica cada cliente enquanto você gerencia CRM, agenda, caixa,
              estoque e campanhas — tudo integrado no WhatsApp que você já usa, num painel só.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2.5 rounded-[13px] bg-brand-500 px-6 py-4 text-base font-bold text-white shadow-[0_14px_30px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-600"
              >
                Começar grátis <ArrowRight size={18} />
              </Link>
              <a
                href="#funciona"
                className="inline-flex items-center gap-2.5 rounded-[13px] border border-[#E0E7E3] bg-white px-6 py-4 text-base font-bold text-ink transition-colors hover:border-brand-400 hover:text-brand-700"
              >
                Ver como funciona
              </a>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-5 text-[13.5px] font-semibold text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand-500" /> Até 4 números de WhatsApp</span>
              <span className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand-500" /> IA de atendimento inclusa</span>
              <span className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand-500" /> Teste grátis, sem cartão</span>
              <span className="inline-flex items-center gap-1.5"><Check size={15} className="text-brand-500" /> Cancele quando quiser</span>
            </div>
          </div>

          {/* product mock */}
          <div className="relative mt-14">
            <div className="overflow-hidden rounded-[18px] border border-[#E6EBE8] bg-white shadow-[0_40px_80px_-32px_rgba(10,27,20,.4)]">
              <div className="flex items-center gap-2 border-b border-[#EEF2F0] bg-[#FBFDFC] px-5 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[#F0625B]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#F5BE4F]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#5FCB7E]" />
                <div className="mx-auto flex items-center gap-2 rounded-lg border border-[#E6EBE8] bg-[#F1F5F3] px-3.5 py-1.5 font-mono text-xs text-slate-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                  app.disparador.ai/leads
                </div>
              </div>
              <div className="bg-[#F7FAF8] p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-display text-[22px] font-bold tracking-[-0.02em]">Leads</div>
                    <div className="mt-0.5 text-[12.5px] text-slate-500">Atualização automática em tempo real</div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-[10px] border border-brand-100 bg-brand-50 px-3 py-2">
                    <span className="h-2 w-2 animate-pulsedot rounded-full bg-brand-400" />
                    <span className="text-[12.5px] font-bold text-brand-700">WhatsApp conectado</span>
                  </div>
                </div>
                <div className="overflow-hidden rounded-[14px] border border-[#EBEFEC] bg-white">
                  <div className="grid grid-cols-[1.6fr_1fr_1fr_0.9fr] border-b border-[#F0F3F1] px-5 py-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-slate-400">
                    <span>Lead</span><span>Status</span><span>Campanha</span><span>Score</span>
                  </div>
                  <MockRow name="Henrique Feitosa" phone="+55 11 9••••-••••" status="Respondeu" tone="green" campaign="Black Friday" score="87" scoreGreen />
                  <MockRow name="Camila Andrade" phone="+55 21 9••••-••••" status="Contatado" tone="amber" campaign="Promoção Junho" score="54" />
                  <MockRow name="Rafael Monteiro" phone="+55 31 9••••-••••" status="Novo" tone="blue" campaign="Reativação" score="31" last />
                </div>
              </div>
            </div>
          </div>
          <p className="mt-5 text-center font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400">
            Imagem ilustrativa da tela do produto · dados de exemplo
          </p>
        </div>
      </section>

      {/* SELOS — proposta de valor honesta, sem métricas inventadas */}
      <section className="border-y border-[rgba(10,27,20,.06)] bg-white">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-6 px-6 py-9 md:grid-cols-4 md:px-8">
          {PERKS.map((p) => (
            <div key={p.label} className="flex items-center justify-center gap-2.5 text-center">
              <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-brand-50 text-brand-500">
                <Check size={16} />
              </span>
              <span className="text-[14.5px] font-bold tracking-[-0.01em] text-ink">{p.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="funciona" className="py-24">
        <div className="mx-auto max-w-[1180px] px-6 md:px-8">
          <SectionHead eyebrow="Como funciona" title={<>Do zero ao negócio rodando<br />em 3 passos</>} sub="Sem instalar nada. Sem técnico. Você mesmo configura em minutos." />
          <div className="grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className={
                  s.dark
                    ? "relative overflow-hidden rounded-[18px] border border-forest bg-forest p-8"
                    : "rounded-[18px] border border-[#EBEFEC] bg-white p-8"
                }
              >
                {s.dark && (
                  <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(95,227,161,.25),transparent_70%)]" />
                )}
                <div className={`font-display text-[52px] font-bold leading-none tracking-[-0.04em] ${s.dark ? "text-[#1E3A2C]" : "text-[#DCEBE3]"}`}>
                  {s.n}
                </div>
                <h3 className={`mt-3.5 font-display text-[21px] font-bold tracking-[-0.01em] ${s.dark ? "text-white" : "text-ink"}`}>
                  {s.title}
                </h3>
                <p className={`mt-2.5 text-[15px] leading-relaxed ${s.dark ? "text-[#9FBCAF]" : "text-slate-600"}`}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RECURSOS */}
      <section id="recursos" className="pb-24">
        <div className="mx-auto max-w-[1180px] px-6 md:px-8">
          <SectionHead eyebrow="Recursos" title={<>Tudo que você precisa<br />num só lugar</>} />
          <div className="grid gap-5 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-[18px] border border-[#EBEFEC] bg-white p-7 transition-colors hover:border-brand-100">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
                  <span className="h-3.5 w-3.5 rounded bg-brand-500" />
                </div>
                <h3 className="mt-4 text-[18px] font-extrabold tracking-[-0.01em]">{f.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PREÇOS */}
      <section id="precos" className="pb-24">
        <div className="mx-auto max-w-[1180px] px-6 md:px-8">
          <SectionHead eyebrow="Planos" title="Preço que cabe no seu negócio" sub="No plano anual você economiza 2 meses. Sem fidelidade, cancele quando quiser." />
          <PricingPlans plans={PLANS} />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="pb-24">
        <div className="mx-auto max-w-[760px] px-6 md:px-8">
          <div className="mx-auto mb-11 text-center">
            <div className="font-mono text-xs uppercase tracking-[0.14em] text-brand-700">Perguntas frequentes</div>
            <h2 className="mt-3.5 font-display text-[36px] font-bold leading-tight tracking-[-0.03em] sm:text-[44px]">Ainda com dúvidas?</h2>
          </div>
          <div className="flex flex-col gap-3">
            {FAQ.map((item) => (
              <details key={item.q} className="rounded-[14px] border border-[#EBEFEC] bg-white px-5">
                <summary className="flex items-center justify-between py-[18px] text-[16.5px] font-bold">
                  {item.q}
                  <span className="faq-plus text-[22px] font-normal text-brand-500 transition-transform">+</span>
                </summary>
                <p className="mb-[18px] text-[15px] leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="pb-24">
        <div className="mx-auto max-w-[1180px] px-6 md:px-8">
          <div className="relative overflow-hidden rounded-[28px] bg-forest px-8 py-16 text-center md:px-12 md:py-[72px]">
            <div className="pointer-events-none absolute -top-24 left-1/2 h-[400px] w-[600px] -translate-x-1/2 bg-[radial-gradient(circle,rgba(95,227,161,.18),transparent_65%)]" />
            <div className="relative">
              <h2 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-white sm:text-[44px] md:text-[50px]">
                Seu negócio merece um sistema
                <br />à altura — no WhatsApp que você já usa
              </h2>
              <p className="mx-auto mt-4 max-w-[520px] text-[17px] leading-snug text-[#9FBCAF] md:text-[18px]">
                Conecte em 30 segundos, deixe a IA atender e comece a gerenciar tudo num painel só.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/signup" className="inline-flex items-center gap-2.5 rounded-[13px] bg-brand-500 px-7 py-4 text-base font-bold text-white shadow-[0_14px_30px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-400">
                  Criar conta grátis <ArrowRight size={18} />
                </Link>
                <Link href="/login" className="inline-flex items-center gap-2.5 rounded-[13px] border border-white/15 bg-white/[.08] px-6 py-4 text-base font-bold text-white transition-colors hover:bg-white/[.14]">
                  Já tenho conta
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[rgba(10,27,20,.07)] bg-white">
        <div className="mx-auto max-w-[1180px] px-6 pb-8 pt-12 md:px-8">
          <div className="flex flex-wrap justify-between gap-8">
            <div className="max-w-[280px]">
              <Logo />
              <p className="mt-3.5 text-[13.5px] leading-relaxed text-slate-500">
                O sistema que atende, vende e gerencia o seu negócio pelo WhatsApp.
              </p>
            </div>
            <div className="flex flex-wrap gap-16">
              <FooterCol title="Produto" links={[["Recursos", "#recursos"], ["Planos", "#precos"], ["Como funciona", "#funciona"]]} />
              <FooterCol title="Empresa" links={[["Perguntas", "#faq"], ["Suporte", "/consultor"], ["Contato", "/consultor"]]} />
              <FooterCol title="Legal" links={[["Privacidade", "/privacidade"], ["Termos", "/termos"], ["Cookies", "/cookies"]]} />
              <FooterCol title="Acesso" links={[["Entrar", "/login"], ["Criar conta", "/signup"]]} />
            </div>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#F0F3F1] pt-6">
            <span className="text-[13px] text-slate-400">© 2026 Disparador.ai · Todos os direitos reservados</span>
            <span className="text-[13px] text-slate-400">Feito no Brasil 🇧🇷</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="mx-auto mb-14 max-w-[640px] text-center">
      <div className="font-mono text-xs uppercase tracking-[0.14em] text-brand-700">{eyebrow}</div>
      <h2 className="mt-3.5 font-display text-[34px] font-bold leading-tight tracking-[-0.03em] sm:text-[44px]">{title}</h2>
      {sub && <p className="mt-4 text-[17px] leading-relaxed text-slate-600">{sub}</p>}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400">{title}</div>
      <div className="flex flex-col gap-2.5 text-[13.5px] font-semibold text-slate-600">
        {links.map(([label, href]) => (
          <Link key={label} href={href} className="hover:text-ink">
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function MockRow({
  name, phone, status, tone, campaign, score, scoreGreen, last,
}: {
  name: string; phone: string; status: string; tone: "green" | "amber" | "blue"; campaign: string; score: string; scoreGreen?: boolean; last?: boolean;
}) {
  const toneCls = {
    green: "bg-brand-50 text-brand-700",
    amber: "bg-[#FEF3E2] text-[#B97309]",
    blue: "bg-[#EAF0FE] text-[#2C5BD6]",
  }[tone];
  return (
    <div className={`grid grid-cols-[1.6fr_1fr_1fr_0.9fr] items-center px-5 py-3.5 ${last ? "" : "border-b border-[#F4F6F5]"}`}>
      <div>
        <div className="text-[13.5px] font-bold">{name}</div>
        <div className="font-mono text-[11.5px] text-slate-400">{phone}</div>
      </div>
      <span><span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${toneCls}`}>{status}</span></span>
      <span className="text-[13px] font-semibold text-slate-600">{campaign}</span>
      <span className={`font-extrabold ${scoreGreen ? "text-brand-500" : "text-slate-600"}`}>{score}</span>
    </div>
  );
}
