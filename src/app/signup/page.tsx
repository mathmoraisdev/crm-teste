"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Logo } from "@/components/app/Logo";

const inputClass =
  "w-full rounded-xl border border-[#E0E7E3] bg-white px-4 py-3.5 text-[15px] outline-none transition-shadow focus:border-brand-400 focus:ring-[3px] focus:ring-brand-500/12";

const STEPS = [
  { title: "Conecte seu WhatsApp", desc: "Sem migrar número, em 30 segundos." },
  { title: "Importe sua lista", desc: "CSV ou manual, organizado por campanha." },
  { title: "Dispare e acompanhe no CRM", desc: "Respostas em tempo real, lead por lead." },
];

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !password) {
      setError("Preencha nome, e-mail e senha.");
      return;
    }
    if (password.length < 8) {
      setError("A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          whatsapp: whatsapp.trim() || undefined,
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Falha ao criar a conta.");
        return;
      }
      router.replace("/leads");
      router.refresh();
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-theme="light" className="grid min-h-screen bg-slate-50 text-ink lg:grid-cols-2">
      {/* form */}
      <div className="flex items-center justify-center px-6 py-12 lg:px-12">
        <form onSubmit={onSubmit} className="w-full max-w-[400px]">
          <Link href="/" className="mb-9 inline-block">
            <Logo />
          </Link>
          <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">Crie sua conta grátis</h1>
          <p className="mt-2 text-[15px] text-slate-500">
            7 dias grátis · sem cartão. Já tem conta?{" "}
            <Link href="/login" className="font-bold text-brand-500 hover:underline">
              Entrar
            </Link>
          </p>

          <div className="mt-7 flex flex-col gap-4">
            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">Nome completo</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">WhatsApp</label>
                <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(11) 9....." className={inputClass} />
              </div>
              <div>
                <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">Senha</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={inputClass} />
              </div>
            </div>

            {error && (
              <p className="rounded-xl bg-[#FDECEC] px-3.5 py-2.5 text-sm font-medium text-[#C0392B]">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1.5 rounded-xl bg-brand-500 py-[15px] text-[15.5px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              {loading ? "Criando conta…" : "Criar conta grátis →"}
            </button>
            <p className="mt-0.5 text-center text-xs leading-snug text-slate-400">
              Ao criar a conta você concorda com os{" "}
              <Link href="/termos" className="font-semibold text-brand-500 hover:underline">
                Termos de Uso
              </Link>{" "}
              e a{" "}
              <Link href="/privacidade" className="font-semibold text-brand-500 hover:underline">
                Política de Privacidade
              </Link>
              .
            </p>
          </div>
        </form>
      </div>

      {/* brand panel */}
      <div className="relative hidden flex-col justify-center overflow-hidden bg-forest p-12 lg:flex">
        <div className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(95,227,161,.2),transparent_65%)]" />
        <div className="relative">
          <h2 className="font-display text-[38px] font-bold leading-[1.1] tracking-[-0.03em] text-white">
            Comece a vender
            <br />em poucos minutos.
          </h2>
          <div className="mt-9 flex max-w-[380px] flex-col gap-[18px]">
            {STEPS.map((s) => (
              <div key={s.title} className="flex items-start gap-3.5">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-mint/15 text-mint">
                  <Check size={15} />
                </span>
                <div>
                  <div className="text-[15px] font-bold text-white">{s.title}</div>
                  <div className="mt-0.5 text-[13.5px] leading-snug text-[#9FBCAF]">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
