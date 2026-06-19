"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/app/Logo";

const inputClass =
  "w-full rounded-xl border border-[#E0E7E3] bg-white px-4 py-3.5 text-[15px] outline-none transition-shadow focus:border-brand-400 focus:ring-[3px] focus:ring-brand-500/12";

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // A rota sempre responde 200 (não revela se o e-mail existe).
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch {
      // Mesmo em erro de rede mostramos a confirmação neutra.
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="mb-9 inline-block">
          <Logo />
        </Link>

        {sent ? (
          <>
            <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">Verifique seu e-mail</h1>
            <p className="mt-2 text-[15px] text-slate-500">
              Se houver uma conta com <strong>{email.trim()}</strong>, enviamos um link para redefinir a senha.
              O link vale por 1 hora.
            </p>
            <Link
              href="/login"
              className="mt-7 inline-block font-bold text-brand-500 hover:underline"
            >
              ← Voltar para o login
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <h1 className="font-display text-[30px] font-bold tracking-[-0.02em]">Esqueceu a senha?</h1>
            <p className="mt-2 text-[15px] text-slate-500">
              Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.
            </p>

            <div className="mt-7 flex flex-col gap-4">
              <div>
                <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">E-mail</label>
                <input
                  type="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@empresa.com.br"
                  className={inputClass}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-1.5 rounded-xl bg-brand-500 py-[15px] text-[15.5px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-600 disabled:opacity-60"
              >
                {loading ? "Enviando…" : "Enviar link →"}
              </button>

              <p className="text-center text-[14px] text-slate-500">
                Lembrou a senha?{" "}
                <Link href="/login" className="font-bold text-brand-500 hover:underline">
                  Entrar
                </Link>
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
