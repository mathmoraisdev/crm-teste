"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/app/Logo";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/leads";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
            <span className="text-[12.5px] font-bold text-slate-400">Esqueci a senha</span>
          </div>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
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
    <div className="grid min-h-screen lg:grid-cols-2">
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
          <div className="mt-8 flex max-w-[380px] items-center gap-2.5 rounded-[14px] border border-white/10 bg-white/5 px-4.5 py-4">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-mint font-extrabold text-forest">★</div>
            <div>
              <div className="text-sm font-bold leading-tight text-white">
                &ldquo;Aumentei minhas vendas em 40% no primeiro mês.&rdquo;
              </div>
              <div className="mt-0.5 text-[12.5px] text-[#9FBCAF]">Marina C. · Loja de roupas</div>
            </div>
          </div>
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
