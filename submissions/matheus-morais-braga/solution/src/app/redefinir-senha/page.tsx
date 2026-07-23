"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/app/Logo";

const inputClass =
  "w-full rounded-xl border border-[#E0E7E3] bg-white px-4 py-3.5 text-[15px] outline-none transition-shadow focus:border-brand-400 focus:ring-[3px] focus:ring-brand-500/12";

function RedefinirSenhaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("Link inválido ou expirado. Solicite um novo.");
      return;
    }
    if (password.length < 8) {
      setError("A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Não foi possível redefinir a senha.");
        return;
      }
      setDone(true);
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="w-full max-w-[400px]">
        <Link href="/" className="mb-9 inline-block">
          <Logo />
        </Link>
        <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">Senha redefinida</h1>
        <p className="mt-2 text-[15px] text-slate-500">
          Sua senha foi alterada com sucesso. Já pode entrar com a nova senha.
        </p>
        <button
          onClick={() => {
            router.replace("/login");
            router.refresh();
          }}
          className="mt-7 rounded-xl bg-brand-500 px-6 py-[15px] text-[15.5px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-600"
        >
          Ir para o login →
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-[400px]">
      <Link href="/" className="mb-9 inline-block">
        <Logo />
      </Link>
      <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">Criar nova senha</h1>
      <p className="mt-2 text-[15px] text-slate-500">Escolha uma senha com ao menos 8 caracteres.</p>

      <div className="mt-7 flex flex-col gap-4">
        <div>
          <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">Nova senha</label>
          <input
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">Confirmar senha</label>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>

        {error && (
          <p className="rounded-xl bg-[#FDECEC] px-3.5 py-2.5 text-sm font-medium text-[#C0392B]">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-1.5 rounded-xl bg-brand-500 py-[15px] text-[15.5px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {loading ? "Salvando…" : "Redefinir senha →"}
        </button>
      </div>
    </form>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <div data-theme="light" className="flex min-h-screen items-center justify-center bg-slate-50 text-ink px-6 py-12">
      <Suspense fallback={null}>
        <RedefinirSenhaForm />
      </Suspense>
    </div>
  );
}
