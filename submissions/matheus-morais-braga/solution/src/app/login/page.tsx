"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/app/Logo";

// Selos honestos (sem métricas/depoimentos inventados): termos comerciais reais.
const PERKS = [
  "Sem fidelidade — cancele quando quiser",
  "Conecte seu WhatsApp em 30 segundos",
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/leads";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Falha no login.");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-[380px]">
      <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">Entrar na conta</h1>
      <p className="mt-2 text-[15px] text-slate-500">
        Não tem conta?{" "}
        <Link href="/signup" className="font-bold text-brand-500 hover:underline">
          Criar grátis
        </Link>
      </p>

      <div className="mt-8 flex flex-col gap-[18px]">
        <Field label="E-mail">
          <input
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com.br"
            className={inputClass}
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[13px] font-bold text-[#1A2A23]">Senha</label>
            <Link
              href="/esqueci-senha"
              className="text-[12.5px] font-bold text-slate-400 transition-colors hover:text-brand-500"
            >
              Esqueci a senha
            </Link>
          </div>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={`${inputClass} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center text-slate-400 transition-colors hover:text-brand-500"
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-[#FDECEC] px-3.5 py-2.5 text-sm font-medium text-[#C0392B]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-1.5 rounded-xl bg-brand-500 py-[15px] text-[15.5px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {loading ? "Entrando…" : "Entrar →"}
        </button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div data-theme="light" className="grid min-h-screen bg-slate-50 text-ink lg:grid-cols-2">
      {/* brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-forest p-12 lg:flex">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(95,227,161,.2),transparent_65%)]" />
        <div className="pointer-events-none absolute -bottom-36 -left-24 h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,.16),transparent_65%)]" />
        <Link href="/" className="relative">
          <Logo dark size="lg" />
        </Link>
        <div className="relative">
          <h2 className="font-display text-[40px] font-bold leading-[1.08] tracking-[-0.03em] text-white">
            Bom te ver
            <br />de volta.
          </h2>
          <p className="mt-4 max-w-[360px] text-[16px] leading-relaxed text-[#9FBCAF]">
            Acesse seu painel, acompanhe seus leads e dispare a próxima campanha em segundos.
          </p>
          <ul className="mt-8 flex max-w-[380px] flex-col gap-3">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-center gap-2.5 text-[14.5px] font-semibold text-[#D8E6DE]">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-white/10 text-mint">
                  <Check size={14} />
                </span>
                {perk}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-[12.5px] text-[#6E8579]">© 2026 Disparador.ai</div>
      </div>

      {/* form */}
      <div className="flex items-center justify-center px-6 py-12 lg:px-12">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-[#E0E7E3] bg-white px-4 py-3.5 text-[15px] outline-none transition-shadow focus:border-brand-400 focus:ring-[3px] focus:ring-brand-500/12";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">{label}</label>
      {children}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3.5 7 10 7a9.12 9.12 0 0 0 3.39-.61" />
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
