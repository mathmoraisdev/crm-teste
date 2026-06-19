/**
 * Primitivos de apresentação compartilhados pelas páginas legais. Mantêm o tom
 * sóbrio da marca (verde + neutros) e a tipografia display/sans/mono do design.
 * Não são páginas — apenas blocos reutilizáveis (cabeçalho, seções, listas).
 */
import { AlertTriangle } from "lucide-react";

/** Cabeçalho do documento: eyebrow, título, aviso jurídico e data de atualização. */
export function LegalHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro: string;
}) {
  return (
    <header className="mb-12">
      {/* Aviso discreto — modelo inicial, revisar com assessoria jurídica. */}
      <div className="mb-7 flex items-start gap-2.5 rounded-[12px] border border-[#FCE9C9] bg-[#FEF7EC] px-4 py-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#B97309]" />
        <p className="text-[13px] font-semibold leading-relaxed text-[#8A5A0B]">
          Modelo inicial — revisar com assessoria jurídica antes de produção.
        </p>
      </div>

      <div className="font-mono text-xs uppercase tracking-[0.14em] text-brand-700">
        {eyebrow}
      </div>
      <h1 className="mt-3.5 font-display text-[36px] font-bold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[44px]">
        {title}
      </h1>
      <p className="mt-4 text-[16.5px] leading-relaxed text-slate-600">{intro}</p>
      <p className="mt-4 font-mono text-[12.5px] uppercase tracking-[0.08em] text-slate-400">
        Última atualização: Junho de 2026
      </p>
      <div className="mt-8 h-px bg-[#E2EAE6]" />
    </header>
  );
}

/** Seção do documento, numerada, com título e conteúdo. */
export function LegalSection({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-11">
      <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink sm:text-[24px]">
        <span className="mr-2.5 font-mono text-[15px] font-medium text-brand-500">{n}.</span>
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4 text-[15.5px] leading-relaxed text-slate-600">
        {children}
      </div>
    </section>
  );
}

/** Parágrafo padrão do corpo do documento. */
export function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

/** Termo / palavra de destaque dentro do texto. */
export function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold text-ink">{children}</strong>;
}

/** Lista com marcadores no estilo da marca. */
export function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Card de destaque para informações de contato (Encarregado / suporte). */
export function ContactCard({
  label,
  email,
  note,
}: {
  label: string;
  email: string;
  note?: string;
}) {
  return (
    <div className="rounded-[16px] border border-[#EBEFEC] bg-white p-6">
      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400">
        {label}
      </div>
      <a
        href={`mailto:${email}`}
        className="mt-1.5 block font-display text-[20px] font-bold tracking-[-0.01em] text-brand-600 hover:text-brand-500"
      >
        {email}
      </a>
      {note && <p className="mt-2 text-[14px] leading-relaxed text-slate-500">{note}</p>}
    </div>
  );
}
